// Starts and stops kernel processes, one per running profile.

import { type ChildProcess, spawn } from 'node:child_process';
import { access, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import { evaluateApart } from './browserControl.ts';
import { coveredLensVideo } from './coveredLens.ts';
import { exitAddress, ExitMemory, proxyKey } from './exitMemory.ts';
import { borrowedLists, listsToKeep, READ_LISTS_SCRIPT } from './hostLists.ts';
import { buildKernelArgs, buildKernelConfig, MAX_PACKED_CONFIG, packedConfigLength } from './kernelConfig.ts';
import { alignToKernel } from './kernelVersion.ts';
import { cameraSource, type Profile, type ProxySettings } from './profile.ts';
import { lookupOwnAddress, lookupProxyExit, type ProxyExit, withOwnAddress, withProxyExit } from './proxyExit.ts';
import { needsRelay, startProxyRelay } from './proxyRelay.ts';
import type { Store } from './store.ts';
import { startRecorder, TransportError } from './transport.ts';
import { reportTransport, type TransportReport } from './transportClaim.ts';
import { allowSandboxToReadKernel } from './winSandbox.ts';

export class LaunchError extends Error {}

/** One second of silence as a WAV file: 16-bit, one channel, 48,000 samples a second. */
export function silentWav(): Buffer {
  const rate = 48_000;
  const data = Buffer.alloc(rate * 2);
  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVEfmt ', 8, 'ascii');
  header.writeUInt32LE(16, 16);        // size of the format block
  header.writeUInt16LE(1, 20);         // PCM
  header.writeUInt16LE(1, 22);         // channels
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 2, 28);  // bytes a second
  header.writeUInt16LE(2, 32);         // bytes a sample frame
  header.writeUInt16LE(16, 34);        // bits a sample
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

export interface ProfileStatus {
  state: 'stopped' | 'running';
  pid?: number;
  startedAt?: string;
  /** DevTools (CDP) HTTP endpoint for automation tools, e.g. http://127.0.0.1:41233 */
  debuggerUrl?: string;
  /**
   * Where the profile's proxy comes out, on a running profile. With `matchProxy` on
   * it is always there and the browser was matched to it. With `matchProxy` off
   * nobody is asked at a start, so it is what is remembered from the last time the
   * proxy was asked (a proxy check, or a matched run), and absent when nothing is.
   */
  proxyExit?: ProxyExit;
  /** When `proxyExit` was last seen to be the proxy's exit. */
  exitSeenAt?: string;
  /**
   * On a stopped profile with a proxy: where that proxy came out the last time it was
   * asked, and when. Only from statusOf(), which knows the profile's proxy.
   */
  lastProxyExit?: ProxyExit & { at: string };
  /**
   * Where it comes out now, when that is no longer where it did at the start. The
   * browser still shows the time zone and WebRTC address of the first exit, which no
   * longer agree with the address sites see: the profile should be restarted.
   */
  exitNow?: ProxyExit & { since: string };
  /** Why the proxy could not be reached at the last look, while that lasts. */
  exitProblem?: string;
  /** Present on a stopped profile whose last run ended on its own. */
  lastExit?: { code: number | null; signal: string | null; at: string };
}

interface Running {
  child: ChildProcess;
  startedAt: string;
  debuggerUrl?: string;
  proxyExit?: ProxyExit;
  exitSeenAt?: string;
  exitNow?: ProxyExit & { since: string };
  exitProblem?: string;
  watch?: NodeJS.Timeout;
  looking?: boolean;
}

/** How long to wait for the kernel to report its DevTools port. */
const DEVTOOLS_WAIT_MS = 90_000;
/** The target list must stay unchanged this long to count as settled... */
const SETTLE_QUIET_MS = 700;
/** ...but a start never waits longer than this for it, */
const SETTLE_MAX_MS = 8_000;
/** ...and gives up early when the endpoint does not serve a target list at all. */
const SETTLE_NO_ANSWER_MS = 1_500;
/** How long the transport report waits for the kernel to reach the recorder. */
const TRANSPORT_WAIT_MS = 30_000;
/** How long a kernel gets to exit cleanly before it is killed. */
const STOP_GRACE_MS = 8_000;

/** Starts the kernel process. Replaceable so tests can run a stand-in kernel. */
export type SpawnKernel = (kernelPath: string, args: string[]) => ChildProcess;

/**
 * Gets the kernel's folder ready for the kernel's own sandbox, and tells whether the
 * network service sandbox can be left on. Replaceable for the same reason.
 */
export type PrepareKernel = (kernelPath: string) => Promise<boolean>;

/**
 * Asks the browser at a DevTools address which lists it reports for the machine
 * (hostLists.ts). Replaceable for the same reason.
 */
export type ReadLists = (debuggerUrl: string) => Promise<unknown>;

const readRealLists: ReadLists = async (debuggerUrl) =>
  JSON.parse(String(await evaluateApart(debuggerUrl, READ_LISTS_SCRIPT))) as unknown;

/**
 * One shape for a profile's state wherever it is reported: `state` ("running" or
 * "stopped") beside `status`, the details. Used for a profile (`{...profile, state,
 * status}`) and for the status, start and stop replies, which also keep the details
 * at the top level where they always were.
 */
export function stateOf(status: ProfileStatus): { state: ProfileStatus['state']; status: ProfileStatus } {
  return { state: status.state, status };
}

/**
 * The state of a profile as its own entry shows it (the list, a single profile):
 * stateOf(), and where its proxy comes out at the top level as well - `proxyExit`,
 * `lastProxyExit` and what goes with them - exactly where the status, start and stop
 * replies have them, so one way of reading the exit works on every reply.
 */
export function entryStateOf(status: ProfileStatus) {
  const { proxyExit, exitSeenAt, lastProxyExit, exitNow, exitProblem } = status;
  const exit = Object.fromEntries(Object.entries({ proxyExit, exitSeenAt, lastProxyExit, exitNow, exitProblem })
      .filter(([, value]) => value !== undefined)) as Pick<ProfileStatus, 'proxyExit' | 'exitSeenAt' | 'lastProxyExit' | 'exitNow' | 'exitProblem'>;
  return { ...exit, ...stateOf(status) };
}

const spawnRealKernel: SpawnKernel = (kernelPath, args) =>
  spawn(kernelPath, args, { stdio: 'ignore', windowsHide: false });

export class Launcher {
  private readonly store: Store;
  private readonly spawnKernel: SpawnKernel;
  private readonly prepareKernel: PrepareKernel;
  private readonly readLists: ReadLists;
  private readonly exits: ExitMemory;
  private readonly running = new Map<string, Running>();
  private readonly lastExit = new Map<string, NonNullable<ProfileStatus['lastExit']>>();

  constructor(store: Store, spawnKernel: SpawnKernel = spawnRealKernel,
              prepareKernel: PrepareKernel = (kernelPath) => allowSandboxToReadKernel(kernelPath),
              readLists: ReadLists = readRealLists) {
    this.store = store;
    this.spawnKernel = spawnKernel;
    this.prepareKernel = prepareKernel;
    this.readLists = readLists;
    this.exits = new ExitMemory(join(store.dataDir, 'exits.json'));
  }

  /** Records where `proxy` was just found to come out (a proxy check), for the profiles that use it. */
  async noteExit(proxy: ProxySettings, exit: ProxyExit): Promise<void> {
    await this.exits.note(proxyKey(proxy), exit);
  }

  /**
   * The status of `profile`, with what only its settings can tell: where the proxy of
   * a stopped profile came out the last time it was asked.
   */
  async statusOf(profile: Pick<Profile, 'id' | 'proxy'>): Promise<ProfileStatus> {
    const status = this.status(profile.id);
    if (status.state === 'running' || !profile.proxy) return status;
    const last = await this.exits.get(proxyKey(profile.proxy));
    return last ? { ...status, lastProxyExit: { ...last.exit, at: last.at } } : status;
  }

  status(id: string): ProfileStatus {
    const entry = this.running.get(id);
    if (!entry) {
      const lastExit = this.lastExit.get(id);
      return lastExit ? { state: 'stopped', lastExit } : { state: 'stopped' };
    }
    return {
      state: 'running',
      pid: entry.child.pid,
      startedAt: entry.startedAt,
      debuggerUrl: entry.debuggerUrl,
      ...(entry.proxyExit ? { proxyExit: entry.proxyExit } : {}),
      ...(entry.proxyExit && entry.exitSeenAt ? { exitSeenAt: entry.exitSeenAt } : {}),
      ...(entry.exitNow ? { exitNow: entry.exitNow } : {}),
      ...(entry.exitProblem ? { exitProblem: entry.exitProblem } : {}),
    };
  }

  isRunning(id: string): boolean {
    return this.running.has(id);
  }

  /** How many profiles are running now. */
  runningCount(): number {
    return this.running.size;
  }

  /**
   * `stored` as it has to be to run on this kernel: a Chrome profile made for another
   * kernel version is moved to this one, and saved that way (kernelVersion.ts).
   */
  private async onThisKernel(stored: Profile, kernelVersion: string): Promise<Profile> {
    const moved = alignToKernel(stored, kernelVersion);
    return moved ? this.store.updateProfile(stored.id, moved) : stored;
  }

  async start(given: Profile): Promise<ProfileStatus> {
    if (this.running.has(given.id)) return this.status(given.id);

    const settings = await this.store.getSettings();
    if (settings.kernelPath === '') {
      throw new LaunchError('No kernel is configured. Set kernelPath in the settings first.');
    }
    try {
      await access(settings.kernelPath);
    } catch {
      throw new LaunchError(`Kernel not found at ${settings.kernelPath}`);
    }
    const stored = await this.onThisKernel(given, settings.kernelVersion);

    // Opening the kernel's folder to its sandbox can take a moment the first time;
    // it does not depend on the proxy, so it runs while the proxy is asked.
    const prepared = this.prepareKernel(settings.kernelPath);
    prepared.catch(() => {});

    // Make the browser agree with where the proxy comes out. Without knowing that,
    // starting would show sites a time zone that contradicts their view of the address.
    let profile = stored;
    let proxyExit: ProxyExit | undefined;
    let exitSeenAt: string | undefined;
    const lookupOn = settings.exitLookupUrl !== '';
    if (stored.proxy && !stored.matchProxy) {
      // Opted out: nobody is asked. What is remembered of this proxy is still shown.
      const last = await this.exits.get(proxyKey(stored.proxy));
      proxyExit = last?.exit;
      exitSeenAt = last?.at;
    } else if (stored.proxy && lookupOn) {
      // An exit seen twice in a row a short while ago is taken to still be there: the
      // start does not wait for the lookup, which runs while the browser comes up
      // and says so if the exit has moved after all (see lookAgain).
      const known = await this.exits.fresh(proxyKey(stored.proxy), settings.exitCacheMinutes);
      if (known) {
        proxyExit = known.exit;
        exitSeenAt = known.at;
      } else {
        try {
          proxyExit = await lookupProxyExit(stored.proxy, settings.exitLookupUrl);
        } catch (error) {
          throw new LaunchError(`Could not find out where the proxy comes out: ${(error as Error).message}. ` +
              'Check the proxy, or turn "match proxy" off for this profile to start anyway.');
        }
        exitSeenAt = (await this.exits.note(proxyKey(stored.proxy), proxyExit)).at;
      }
      // Without a time zone for the exit the browser would show this machine's,
      // which is the one thing matching is there to prevent.
      if (stored.timezone === '' && proxyExit.timezone === '') {
        throw new LaunchError('The lookup services told the address of the proxy but not its time zone, so the ' +
            'browser would show the time zone of this machine. Give the profile a time zone, add a lookup service that tells it, ' +
            'or turn "match proxy" off for this profile to start anyway.');
      }
      profile = withProxyExit(stored, proxyExit);
    } else if (!stored.proxy && stored.matchProxy && lookupOn &&
               stored.webrtc === 'proxyOnly' && stored.webrtcPublicIp === '') {
      // No proxy: sites see this machine's own address, so WebRTC may show it too,
      // as an ordinary browser would. If it cannot be found out the profile still
      // starts; WebRTC then shows no public address, which is safe. (Never taken from
      // memory: this machine's address changes with its network, and an old one must
      // not be shown on a new network.)
      try {
        profile = withOwnAddress(stored, await lookupOwnAddress(settings.exitLookupUrl));
      } catch {
        // Keep the stored profile.
      }
    }

    const profileDir = this.store.profileDir(profile.id);
    const userDataDir = join(profileDir, 'browser');
    const configFile = join(profileDir, 'kernel.json');
    await mkdir(userDataDir, { recursive: true });
    // The kernel hands the file's text, deflated, to each of its child processes on
    // their command line, which Windows limits to 32,767 characters. Past that, the
    // children cannot start and the browser dies at once.
    const config = JSON.stringify(buildKernelConfig(profile));
    if (packedConfigLength(config) > MAX_PACKED_CONFIG) {
      throw new LaunchError(`This profile's settings are too large to start (${packedConfigLength(config)} characters ` +
          `when packed; the limit is ${MAX_PACKED_CONFIG}). Shorten its font or voice list.`);
    }
    await writeFile(configFile, config, 'utf8');

    // A camera picture from a file: the file must be there, and beside it goes a
    // second of silence for the microphone (the kernel's stand-in would beep).
    let silenceFile: string | undefined;
    let coveredLensFile: string | undefined;
    const camera = cameraSource(profile);
    if (camera === 'file') {
      try {
        await access(profile.cameraFile);
      } catch {
        throw new LaunchError(`The camera picture of this profile, ${profile.cameraFile}, is not there.`);
      }
    }
    if (camera === 'covered') {
      // Made once: the grain is the profile's own and does not change.
      coveredLensFile = join(profileDir, 'covered-lens.y4m');
      const made = await stat(coveredLensFile).then((file) => file.size, () => 0);
      const video = made > 0 ? undefined : coveredLensVideo(profile.seed);
      if (video !== undefined) await writeFile(coveredLensFile, video);
    }
    if (camera !== 'machine') {
      silenceFile = join(profileDir, 'silence.wav');
      await writeFile(silenceFile, silentWav());
    }

    // A port file left over from an earlier run would point at a dead port.
    const portFile = join(userDataDir, 'DevToolsActivePort');
    await rm(portFile, { force: true });

    // A proxy with a login is reached through a local relay that logs in for the kernel.
    const relay = needsRelay(profile.proxy) ? await startProxyRelay(profile.proxy) : undefined;
    const proxyServer = relay ? `socks5://127.0.0.1:${relay.port}` : undefined;
    let networkSandbox: boolean;
    try {
      networkSandbox = await prepared;
    } catch (error) {
      await relay?.close();
      throw error;
    }
    const args = buildKernelArgs(profile, { userDataDir, configFile, proxyServer, networkSandbox, silenceFile, coveredLensFile }, settings.extraArgs);
    const child = this.spawnKernel(settings.kernelPath, args);

    const spawned = new Promise<void>((resolve, reject) => {
      child.once('spawn', resolve);
      child.once('error', (error) => reject(new LaunchError(`Could not start the kernel: ${error.message}`)));
    });
    try {
      await spawned;
    } catch (error) {
      await relay?.close();
      throw error;
    }

    const entry: Running = { child, startedAt: new Date().toISOString(), proxyExit, exitSeenAt };
    this.running.set(profile.id, entry);
    this.lastExit.delete(profile.id);
    if (stored.proxy && stored.matchProxy && lookupOn) {
      const proxy = stored.proxy;
      // One look while the browser comes up. It checks an exit taken from memory, and
      // is the second sighting that lets the next start take this exit from memory.
      // (Not with exitCacheMinutes 0: then every start asks first, and only once.)
      if (settings.exitCacheMinutes > 0) void this.lookAgain(entry, proxy, settings.exitLookupUrl);
      // A proxy's exit can change or go away while the profile runs, and the browser
      // cannot be re-matched without a restart: look again now and then, and say so.
      if (settings.exitWatchMinutes > 0) {
        entry.watch = setInterval(() => {
          void this.lookAgain(entry, proxy, settings.exitLookupUrl);
        }, settings.exitWatchMinutes * 60_000);
        entry.watch.unref();
      }
    }
    child.once('exit', (code, signal) => {
      clearInterval(entry.watch);
      void relay?.close();
      if (this.running.get(profile.id) === entry) this.running.delete(profile.id);
      this.lastExit.set(profile.id, { code, signal, at: new Date().toISOString() });
    });

    entry.debuggerUrl = await this.waitForDebuggerUrl(profile.id, entry, portFile);
    if (entry.debuggerUrl) await this.waitUntilSettled(profile.id, entry, entry.debuggerUrl);
    if (!this.running.has(profile.id)) {
      const exit = this.lastExit.get(profile.id);
      throw new LaunchError(`The kernel exited right after starting (exit code ${exit?.code ?? 'unknown'}).`);
    }
    // Languages that came from the proxy's exit are the exit's, not the profile's:
    // saved, they would stay when the proxy comes out somewhere else.
    const matchedLanguages = stored.languages.length === 0 && profile.languages.length > 0;
    if (entry.debuggerUrl && borrowedLists(stored).length > 0) void this.keepLists(stored.id, entry.debuggerUrl, matchedLanguages);
    return this.status(profile.id);
  }

  /**
   * Saves in the profile the lists it left to this machine (hostLists.ts), as its
   * browser reported them just now. Best effort: a browser that cannot be asked is
   * asked again at the next start.
   */
  private async keepLists(id: string, debuggerUrl: string, matchedLanguages = false): Promise<void> {
    try {
      const read = await this.readLists(debuggerUrl);
      // Read again: the profile may have been edited while the browser started.
      const current = await this.store.getProfile(id);
      const keep = listsToKeep(current, read);
      if (matchedLanguages) delete keep.languages;
      if (keep.voices && packedConfigLength(JSON.stringify(buildKernelConfig({ ...current, ...keep }))) > MAX_PACKED_CONFIG) {
        delete keep.voices;
      }
      if (Object.keys(keep).length > 0) await this.store.updateProfile(id, keep);
    } catch {
      // Not a browser that can be asked, or the profile is gone.
    }
  }

  /** Asks once more where `proxy` comes out and records the answer, a change or a failure on `entry`. */
  private async lookAgain(entry: Running, proxy: ProxySettings, lookupSetting: string): Promise<void> {
    // A look at a proxy in trouble takes a while (it is retried); the next one waits for it.
    if (entry.looking) return;
    entry.looking = true;
    try {
      const now = await lookupProxyExit(proxy, lookupSetting);
      const seen = await this.exits.note(proxyKey(proxy), now);
      entry.exitProblem = undefined;
      if (!entry.proxyExit || exitAddress(now) === exitAddress(entry.proxyExit)) {
        entry.exitSeenAt = seen.at;
        entry.exitNow = undefined;
      } else if (!entry.exitNow || exitAddress(entry.exitNow) !== exitAddress(now)) {
        entry.exitNow = { ...now, since: new Date().toISOString() };
      }
    } catch (error) {
      entry.exitProblem = (error as Error).message;
    } finally {
      entry.looking = false;
    }
  }

  /** The kernel writes "<port>\n<browser path>" to DevToolsActivePort once it listens. */
  private async waitForDebuggerUrl(id: string, entry: Running, portFile: string): Promise<string | undefined> {
    const deadline = Date.now() + DEVTOOLS_WAIT_MS;
    while (Date.now() < deadline && this.running.get(id) === entry) {
      try {
        const port = Number((await readFile(portFile, 'utf8')).split('\n')[0]);
        if (Number.isInteger(port) && port > 0) return `http://127.0.0.1:${port}`;
      } catch {
        // Not written yet.
      }
      await delay(100);
    }
    return undefined;
  }

  /**
   * The DevTools port answers before the browser has finished starting, and a tab
   * opened in that window can lose its navigation and stay blank. Wait until the
   * list of targets has a page and has stopped changing, so that a client may use
   * the endpoint as soon as start() returns.
   */
  private async waitUntilSettled(id: string, entry: Running, debuggerUrl: string): Promise<void> {
    const started = Date.now();
    let answered = false;
    let previous = '';
    let unchangedSince = 0;
    while (Date.now() - started < SETTLE_MAX_MS && this.running.get(id) === entry) {
      try {
        const response = await fetch(`${debuggerUrl}/json/list`, { signal: AbortSignal.timeout(1000) });
        const targets = (await response.json()) as { type: string; url: string }[];
        answered = true;
        const snapshot = JSON.stringify(targets.map((target) => [target.type, target.url]));
        if (snapshot !== previous) {
          previous = snapshot;
          unchangedSince = Date.now();
        } else if (targets.some((target) => target.type === 'page') &&
                   Date.now() - unchangedSince >= SETTLE_QUIET_MS) {
          return;
        }
      } catch {
        // Not a browser that serves the target list (or not yet): do not hold up the start.
        if (!answered && Date.now() - started > SETTLE_NO_ANSWER_MS) return;
      }
      await delay(50);
    }
  }

  /**
   * How `profile`'s browser introduces itself to a server - its TLS hello and the
   * opening of its HTTP/2 connection - beside what the profile claims to be.
   *
   * Measured, not assumed: a second, windowless copy of the kernel is started with
   * the profile's settings in a folder of its own and sent to a recorder on this
   * machine (transport.ts). It works the same whether the profile is running or not
   * and touches neither its browser data nor its tabs (a Chrome profile made for
   * another kernel version is first moved to this one, as a start would). The copy can reach nothing
   * but the recorder: it gets no proxy, and every other name is made unresolvable.
   */
  async transport(given: Profile): Promise<TransportReport> {
    const settings = await this.store.getSettings();
    if (settings.kernelPath === '') {
      throw new LaunchError('No kernel is configured. Set kernelPath in the settings first.');
    }
    try {
      await access(settings.kernelPath);
    } catch {
      throw new LaunchError(`Kernel not found at ${settings.kernelPath}`);
    }
    // Measured as it would be started: on this kernel's version.
    const stored = await this.onThisKernel(given, settings.kernelVersion);
    const networkSandbox = await this.prepareKernel(settings.kernelPath);
    const dir = await mkdtemp(join(tmpdir(), 'proteus-transport-'));
    const recorder = await startRecorder(TRANSPORT_WAIT_MS);
    let child: ChildProcess | undefined;
    try {
      const profile: Profile = { ...stored, proxy: null, startUrl: recorder.url };
      const userDataDir = join(dir, 'browser');
      const configFile = join(dir, 'kernel.json');
      await mkdir(userDataDir, { recursive: true });
      await writeFile(configFile, JSON.stringify(buildKernelConfig(profile)), 'utf8');
      const args = buildKernelArgs(profile, { userDataDir, configFile, networkSandbox }, [
        ...settings.extraArgs,
        '--headless=new',
        // The recorder's certificate is made on the spot and signed by nobody.
        '--ignore-certificate-errors',
        '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost',
      ]);
      const started = this.spawnKernel(settings.kernelPath, args);
      child = started;
      const failed = new Promise<never>((_resolve, reject) => {
        started.once('error', (error) => reject(new LaunchError(`Could not start the kernel: ${error.message}`)));
        started.once('exit', (code) => reject(new LaunchError(
            `The kernel exited before it connected (exit code ${code ?? 'unknown'}).`)));
      });
      failed.catch(() => {});
      const shape = await Promise.race([recorder.shape, failed]);
      return reportTransport(stored, settings.kernelVersion, shape);
    } catch (error) {
      if (error instanceof TransportError) throw new LaunchError(`Could not record the handshake: ${error.message}.`);
      throw error;
    } finally {
      await recorder.close();
      if (child && child.exitCode === null && child.signalCode === null) {
        const leaving = child;
        const exited = new Promise<void>((resolve) => leaving.once('exit', () => resolve()));
        leaving.kill();
        await Promise.race([exited, delay(STOP_GRACE_MS)]);
      }
      // The kernel's helper processes let go of their files a moment after it exits.
      await rm(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 }).catch(() => {});
    }
  }

  async stop(id: string): Promise<ProfileStatus> {
    const entry = this.running.get(id);
    if (!entry) return this.status(id);

    const exited = new Promise<void>((resolve) => entry.child.once('exit', () => resolve()));
    entry.child.kill();
    const timedOut = await Promise.race([exited.then(() => false), delay(STOP_GRACE_MS).then(() => true)]);
    if (timedOut) {
      entry.child.kill('SIGKILL');
      await exited;
    }
    return this.status(id);
  }

  async stopAll(): Promise<void> {
    await Promise.all([...this.running.keys()].map((id) => this.stop(id)));
  }
}

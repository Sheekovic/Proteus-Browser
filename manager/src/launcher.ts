// Starts and stops kernel processes, one per running profile.

import { type ChildProcess, spawn } from 'node:child_process';
import { access, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import { buildKernelArgs, buildKernelConfig } from './kernelConfig.ts';
import type { Profile } from './profile.ts';
import { lookupOwnAddress, lookupProxyExit, type ProxyExit, withOwnAddress, withProxyExit } from './proxyExit.ts';
import { needsRelay, startProxyRelay } from './proxyRelay.ts';
import type { Store } from './store.ts';
import { allowSandboxToReadKernel } from './winSandbox.ts';

export class LaunchError extends Error {}

export interface ProfileStatus {
  state: 'stopped' | 'running';
  pid?: number;
  startedAt?: string;
  /** DevTools (CDP) HTTP endpoint for automation tools, e.g. http://127.0.0.1:41233 */
  debuggerUrl?: string;
  /** Where the profile's proxy comes out, when it was looked up for this run. */
  proxyExit?: ProxyExit;
  /** Present on a stopped profile whose last run ended on its own. */
  lastExit?: { code: number | null; signal: string | null; at: string };
}

interface Running {
  child: ChildProcess;
  startedAt: string;
  debuggerUrl?: string;
  proxyExit?: ProxyExit;
}

/** How long to wait for the kernel to report its DevTools port. */
const DEVTOOLS_WAIT_MS = 90_000;
/** The target list must stay unchanged this long to count as settled... */
const SETTLE_QUIET_MS = 700;
/** ...but a start never waits longer than this for it, */
const SETTLE_MAX_MS = 8_000;
/** ...and gives up early when the endpoint does not serve a target list at all. */
const SETTLE_NO_ANSWER_MS = 1_500;
/**
 * Largest kernel configuration a start accepts. Base64 makes it a third longer on the
 * child processes' command lines, next to several thousand characters of their own.
 */
const MAX_CONFIG_BYTES = 16_000;
/** How long a kernel gets to exit cleanly before it is killed. */
const STOP_GRACE_MS = 8_000;

/** Starts the kernel process. Replaceable so tests can run a stand-in kernel. */
export type SpawnKernel = (kernelPath: string, args: string[]) => ChildProcess;

/**
 * Gets the kernel's folder ready for the kernel's own sandbox, and tells whether the
 * network service sandbox can be left on. Replaceable for the same reason.
 */
export type PrepareKernel = (kernelPath: string) => Promise<boolean>;

const spawnRealKernel: SpawnKernel = (kernelPath, args) =>
  spawn(kernelPath, args, { stdio: 'ignore', windowsHide: false });

export class Launcher {
  private readonly store: Store;
  private readonly spawnKernel: SpawnKernel;
  private readonly prepareKernel: PrepareKernel;
  private readonly running = new Map<string, Running>();
  private readonly lastExit = new Map<string, NonNullable<ProfileStatus['lastExit']>>();

  constructor(store: Store, spawnKernel: SpawnKernel = spawnRealKernel,
              prepareKernel: PrepareKernel = (kernelPath) => allowSandboxToReadKernel(kernelPath)) {
    this.store = store;
    this.spawnKernel = spawnKernel;
    this.prepareKernel = prepareKernel;
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
    };
  }

  isRunning(id: string): boolean {
    return this.running.has(id);
  }

  async start(stored: Profile): Promise<ProfileStatus> {
    if (this.running.has(stored.id)) return this.status(stored.id);

    const settings = await this.store.getSettings();
    if (settings.kernelPath === '') {
      throw new LaunchError('No kernel is configured. Set kernelPath in the settings first.');
    }
    try {
      await access(settings.kernelPath);
    } catch {
      throw new LaunchError(`Kernel not found at ${settings.kernelPath}`);
    }

    // Make the browser agree with where the proxy comes out. Without knowing that,
    // starting would show sites a time zone that contradicts their view of the address.
    let profile = stored;
    let proxyExit: ProxyExit | undefined;
    if (stored.proxy && stored.matchProxy && settings.exitLookupUrl !== '') {
      try {
        proxyExit = await lookupProxyExit(stored.proxy, settings.exitLookupUrl);
      } catch (error) {
        throw new LaunchError(`Could not find out where the proxy comes out: ${(error as Error).message}. ` +
            'Check the proxy, or turn "match proxy" off for this profile to start anyway.');
      }
      profile = withProxyExit(stored, proxyExit);
    } else if (!stored.proxy && stored.matchProxy && settings.exitLookupUrl !== '' &&
               stored.webrtc === 'proxyOnly' && stored.webrtcPublicIp === '') {
      // No proxy: sites see this machine's own address, so WebRTC may show it too,
      // as an ordinary browser would. If it cannot be found out the profile still
      // starts; WebRTC then shows no public address, which is safe.
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
    // Written without indentation on purpose: the kernel hands the file's text to each
    // of its child processes on their command line, which Windows limits to 32,767
    // characters. Past that, the children cannot start and the browser dies at once.
    const config = JSON.stringify(buildKernelConfig(profile));
    if (Buffer.byteLength(config) > MAX_CONFIG_BYTES) {
      throw new LaunchError(`This profile's settings are too large to start (${Buffer.byteLength(config)} bytes; ` +
          `the limit is ${MAX_CONFIG_BYTES}). Shorten its font or voice list.`);
    }
    await writeFile(configFile, config, 'utf8');

    // A port file left over from an earlier run would point at a dead port.
    const portFile = join(userDataDir, 'DevToolsActivePort');
    await rm(portFile, { force: true });

    // A proxy with a login is reached through a local relay that logs in for the kernel.
    const relay = needsRelay(profile.proxy) ? await startProxyRelay(profile.proxy) : undefined;
    const proxyServer = relay ? `socks5://127.0.0.1:${relay.port}` : undefined;
    const networkSandbox = await this.prepareKernel(settings.kernelPath);
    const args = buildKernelArgs(profile, { userDataDir, configFile, proxyServer, networkSandbox }, settings.extraArgs);
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

    const entry: Running = { child, startedAt: new Date().toISOString(), proxyExit };
    this.running.set(profile.id, entry);
    this.lastExit.delete(profile.id);
    child.once('exit', (code, signal) => {
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
    return this.status(profile.id);
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

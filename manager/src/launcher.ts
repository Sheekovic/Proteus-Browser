// Starts and stops kernel processes, one per running profile.

import { type ChildProcess, spawn } from 'node:child_process';
import { access, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import { buildKernelArgs, buildKernelConfig } from './kernelConfig.ts';
import type { Profile } from './profile.ts';
import type { Store } from './store.ts';

export class LaunchError extends Error {}

export interface ProfileStatus {
  state: 'stopped' | 'running';
  pid?: number;
  startedAt?: string;
  /** DevTools (CDP) HTTP endpoint for automation tools, e.g. http://127.0.0.1:41233 */
  debuggerUrl?: string;
  /** Present on a stopped profile whose last run ended on its own. */
  lastExit?: { code: number | null; signal: string | null; at: string };
}

interface Running {
  child: ChildProcess;
  startedAt: string;
  debuggerUrl?: string;
}

/** How long to wait for the kernel to report its DevTools port. */
const DEVTOOLS_WAIT_MS = 20_000;
/** How long a kernel gets to exit cleanly before it is killed. */
const STOP_GRACE_MS = 8_000;

/** Starts the kernel process. Replaceable so tests can run a stand-in kernel. */
export type SpawnKernel = (kernelPath: string, args: string[]) => ChildProcess;

const spawnRealKernel: SpawnKernel = (kernelPath, args) =>
  spawn(kernelPath, args, { stdio: 'ignore', windowsHide: false });

export class Launcher {
  private readonly store: Store;
  private readonly spawnKernel: SpawnKernel;
  private readonly running = new Map<string, Running>();
  private readonly lastExit = new Map<string, NonNullable<ProfileStatus['lastExit']>>();

  constructor(store: Store, spawnKernel: SpawnKernel = spawnRealKernel) {
    this.store = store;
    this.spawnKernel = spawnKernel;
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
    };
  }

  isRunning(id: string): boolean {
    return this.running.has(id);
  }

  async start(profile: Profile): Promise<ProfileStatus> {
    if (this.running.has(profile.id)) return this.status(profile.id);

    const settings = await this.store.getSettings();
    if (settings.kernelPath === '') {
      throw new LaunchError('No kernel is configured. Set kernelPath in the settings first.');
    }
    try {
      await access(settings.kernelPath);
    } catch {
      throw new LaunchError(`Kernel not found at ${settings.kernelPath}`);
    }

    const profileDir = this.store.profileDir(profile.id);
    const userDataDir = join(profileDir, 'browser');
    const configFile = join(profileDir, 'kernel.json');
    await mkdir(userDataDir, { recursive: true });
    await writeFile(configFile, JSON.stringify(buildKernelConfig(profile), null, 2), 'utf8');

    // A port file left over from an earlier run would point at a dead port.
    const portFile = join(userDataDir, 'DevToolsActivePort');
    await rm(portFile, { force: true });

    const args = buildKernelArgs(profile, { userDataDir, configFile }, settings.extraArgs);
    const child = this.spawnKernel(settings.kernelPath, args);

    const spawned = new Promise<void>((resolve, reject) => {
      child.once('spawn', resolve);
      child.once('error', (error) => reject(new LaunchError(`Could not start the kernel: ${error.message}`)));
    });
    await spawned;

    const entry: Running = { child, startedAt: new Date().toISOString() };
    this.running.set(profile.id, entry);
    this.lastExit.delete(profile.id);
    child.once('exit', (code, signal) => {
      if (this.running.get(profile.id) === entry) this.running.delete(profile.id);
      this.lastExit.set(profile.id, { code, signal, at: new Date().toISOString() });
    });

    entry.debuggerUrl = await this.waitForDebuggerUrl(profile.id, entry, portFile);
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

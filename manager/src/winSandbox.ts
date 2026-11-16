// Windows: letting the kernel's sandboxed processes read the kernel.
//
// The kernel runs its network service inside an "app container". A process in one can
// only read files whose permissions name app containers, and the files of a kernel
// unpacked from an archive do not: the service then cannot even load chrome.exe, it
// dies as the browser starts, and the first page never loads. (An installer would
// set this up; there is none.)
//
// The cure is the one Chromium documents for its own developers: grant read and
// execute on the kernel's folder to the two groups that stand for app containers.
// The user owns the folder they unpacked, so this needs no administrator rights.

import { spawn } from 'node:child_process';
import { dirname } from 'node:path';

/** Runs a program and resolves with its exit code (or -1 if it could not be run). */
export type RunCommand = (program: string, args: string[]) => Promise<number>;

const runQuietly: RunCommand = (program, args) => new Promise((resolve) => {
  const child = spawn(program, args, { stdio: 'ignore', windowsHide: true });
  child.once('error', () => resolve(-1));
  child.once('exit', (code) => resolve(code ?? -1));
});

/** "ALL APPLICATION PACKAGES" and "ALL RESTRICTED APPLICATION PACKAGES", by their fixed ids. */
const APP_CONTAINER_GROUPS = ['*S-1-15-2-1', '*S-1-15-2-2'];

/** The icacls arguments that give app containers read and execute on `folder` and all in it. */
export function grantArguments(folder: string): string[] {
  return [folder, '/grant', ...APP_CONTAINER_GROUPS.map((group) => `${group}:(OI)(CI)(RX)`), '/T', '/Q'];
}

const done = new Map<string, Promise<boolean>>();

/**
 * Makes the folder of the kernel at `kernelPath` readable by the kernel's sandboxed
 * processes. Resolves to whether it is now so; false means the kernel has to be
 * started without the network service sandbox. Does nothing, and resolves true, on
 * other systems. Done once per folder for the life of this process.
 */
export function allowSandboxToReadKernel(kernelPath: string, platform: NodeJS.Platform = process.platform,
                                         run: RunCommand = runQuietly): Promise<boolean> {
  if (platform !== 'win32') return Promise.resolve(true);
  const folder = dirname(kernelPath);
  let result = done.get(folder);
  if (result === undefined) {
    result = run('icacls', grantArguments(folder)).then((code) => code === 0, () => false);
    done.set(folder, result);
  }
  return result;
}

/** Forgets what has been done, for tests. */
export function resetSandboxAccessCache(): void {
  done.clear();
}

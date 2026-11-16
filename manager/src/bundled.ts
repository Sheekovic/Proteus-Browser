// Finding the kernel without being told where it is.
//
// A release folder holds the manager and the kernel side by side:
//   Proteus/manager/src/main.ts
//   Proteus/kernel/chrome(.exe)
// so a fresh start needs no setting up. PROTEUS_KERNEL names another kernel.

import { existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Path of a kernel executable that exists: the one PROTEUS_KERNEL names, else the one
 * in the `kernel` folder next to `managerDir`. undefined when there is neither.
 */
export function findKernel(managerDir: string, env: NodeJS.ProcessEnv = process.env,
                           platform: NodeJS.Platform = process.platform): string | undefined {
  const executable = platform === 'win32' ? 'chrome.exe' : 'chrome';
  const candidates = [env.PROTEUS_KERNEL, join(managerDir, '..', 'kernel', executable)];
  return candidates.find((path): path is string => typeof path === 'string' && path !== '' && existsSync(path));
}

/** The command that opens `url` in the user's own browser, as [program, ...arguments]. */
export function openCommand(url: string, platform: NodeJS.Platform = process.platform): string[] {
  if (platform === 'win32') return ['cmd', '/c', 'start', '', url];
  if (platform === 'darwin') return ['open', url];
  return ['xdg-open', url];
}

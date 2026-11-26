// Finding the kernel without being told where it is.
//
// A release folder holds the manager and the kernel side by side:
//   Proteus/manager/src/main.ts
//   Proteus/kernel/chrome(.exe)
// so a fresh start needs no setting up. PROTEUS_KERNEL names another kernel.

import { existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The folder of the fonts that come with Proteus, when it is there: the one
 * PROTEUS_FONTS names, else `fonts` next to `managerDir` (a release folder has it).
 */
export function findFonts(managerDir: string, env: NodeJS.ProcessEnv = process.env): string | undefined {
  const candidates = [env.PROTEUS_FONTS, join(managerDir, '..', 'fonts')];
  return candidates.find((path): path is string => typeof path === 'string' && path !== '' && existsSync(path));
}

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

/**
 * Arguments that make the kernel show `url` as an application window of its own: no
 * tabs or address bar, the Proteus icon in the taskbar. It runs as an unmodified
 * browser (no profile), with data of its own under `dataDir`, and is told to fetch
 * nothing by itself.
 */
export function appWindowArguments(url: string, dataDir: string): string[] {
  return [
    `--app=${url}`, `--user-data-dir=${join(dataDir, 'manager-window')}`, '--window-size=1180,800',
    '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--disable-component-update',
    '--disable-sync', '--disable-default-apps', '--no-pings',
    // Started as administrator, the process must stay the window: the manager ends
    // when it does (see DO_NOT_DE_ELEVATE in kernelConfig.ts).
    '--do-not-de-elevate',
  ];
}

/** The command that opens `url` in the user's own browser, as [program, ...arguments]. */
export function openCommand(url: string, platform: NodeJS.Platform = process.platform): string[] {
  if (platform === 'win32') return ['cmd', '/c', 'start', '', url];
  if (platform === 'darwin') return ['open', url];
  return ['xdg-open', url];
}

// Starting Proteus when the user signs in to the machine: the setting
// "startWithMachine", off unless the user turns it on.
//
// Nothing here needs administrator rights or reaches beyond the user's own account:
//   Windows  a value named Proteus under the user's own Run key in the registry
//   Linux    a desktop entry in the user's autostart folder (~/.config/autostart)
// Either starts Proteus the way its shortcut does, window and all.

import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import * as path from 'node:path';

export const RUN_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run';
export const RUN_VALUE = 'Proteus';

/** What turns the start on or off on this system. */
export type AutostartPlan =
  | { kind: 'registry'; command: string }
  | { kind: 'desktop'; file: string; text: string };

export interface AutostartPlace {
  platform: NodeJS.Platform;
  /** The manager's folder (the one with src in it). */
  managerDir: string;
  /** The Node.js running the manager. */
  nodePath: string;
  /** The user's settings folder on Linux (XDG_CONFIG_HOME, or ~/.config). */
  configHome?: string;
  /** Whether a file is there; for tests. */
  exists?: (path: string) => boolean;
}

/** A word of an Exec line of a desktop entry. */
function desktopWord(word: string): string {
  return '"' + word.replace(/[\\"`$]/g, '\\$&').replace(/%/g, '%%') + '"';
}

/**
 * How Proteus is started at sign-in from where it is now, or null on a system that has
 * no such start here. In a release folder that is the folder's own start script, which
 * knows the Node.js that came with it; otherwise the manager itself.
 */
export function autostartPlan(place: AutostartPlace): AutostartPlan | null {
  const exists = place.exists ?? existsSync;
  // A Windows path is taken apart as one, whatever system this runs on.
  const { dirname, join } = place.platform === 'win32' ? path.win32 : path;
  const root = dirname(place.managerDir);
  const main = join(place.managerDir, 'src', 'main.ts');
  if (place.platform === 'win32') {
    const script = join(root, 'Start Proteus.cmd');
    const started = exists(script) ? `"${script}"` : `"${place.nodePath}" "${main}" --open`;
    // "start /min": the console that shows what Proteus is doing starts out of the way.
    return { kind: 'registry', command: `cmd.exe /c start "Proteus" /min ${started}` };
  }
  if (place.platform === 'linux') {
    const script = join(root, 'start-proteus.sh');
    const started = exists(script) ? desktopWord(script) : `${desktopWord(place.nodePath)} ${desktopWord(main)} --open`;
    const configHome = place.configHome || join(homedir(), '.config');
    return {
      kind: 'desktop',
      file: join(configHome, 'autostart', 'proteus.desktop'),
      text: `[Desktop Entry]\nType=Application\nName=Proteus\nComment=Starts Proteus when you sign in\nExec=${started}\nTerminal=false\n`,
    };
  }
  return null;
}

/** Runs a program and gives what it printed; fails when the program does. */
export type Run = (program: string, args: string[]) => Promise<string>;

const runProgram: Run = (program, args) => new Promise((resolve, reject) => {
  execFile(program, args, { windowsHide: true }, (error, stdout) => error ? reject(error) : resolve(stdout));
});

/** Turns the start at sign-in on or off as `plan` says. Turning off what is not on is fine. */
export async function setAutostart(on: boolean, plan: AutostartPlan, run: Run = runProgram): Promise<void> {
  if (plan.kind === 'desktop') {
    if (!on) return rm(plan.file, { force: true });
    await mkdir(path.dirname(plan.file), { recursive: true });
    return writeFile(plan.file, plan.text, 'utf8');
  }
  if (on) {
    await run('reg.exe', ['add', RUN_KEY, '/v', RUN_VALUE, '/t', 'REG_SZ', '/d', plan.command, '/f']);
    return;
  }
  // Deleting a value that is not there is an error to reg.exe and no fault here.
  const there = await run('reg.exe', ['query', RUN_KEY, '/v', RUN_VALUE]).then(() => true, () => false);
  if (there) await run('reg.exe', ['delete', RUN_KEY, '/v', RUN_VALUE, '/f']);
}

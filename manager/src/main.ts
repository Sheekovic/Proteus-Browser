// Entry point: `node src/main.ts [--port 5310] [--open | --open-browser]`
//   --open           also shows the manager in a window of its own
//   --open-browser   also opens the manager in the user's usual browser

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { autostartPlan, setAutostart } from './autostart.ts';
import { appWindowArguments, findFonts, findKernel, openCommand } from './bundled.ts';
import { Launcher } from './launcher.ts';
import { createApiServer } from './server.ts';
import { ValidationError } from './profile.ts';
import { Store } from './store.ts';
import { Updater } from './updater.ts';
import { allowSandboxToReadKernel } from './winSandbox.ts';

const DEFAULT_PORT = 5310;

function parsePort(argv: readonly string[]): number {
  const index = argv.indexOf('--port');
  const raw = index >= 0 ? argv[index + 1] : process.env.PROTEUS_PORT;
  if (raw === undefined) return DEFAULT_PORT;
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`"${raw}" is not a valid port`);
  }
  return port;
}

const argv = process.argv.slice(2);
const managerDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const store = new Store();
const launcher = new Launcher(store);
launcher.fontDir = findFonts(managerDir);
// Starting with the machine (autostart.ts): the setting tells the system, and a
// Proteus that was moved since tells it again where it is now.
const startPlan = autostartPlan({ platform: process.platform, managerDir, nodePath: process.execPath, configHome: process.env.XDG_CONFIG_HOME });
store.applyStartWithMachine = async (on) => {
  if (startPlan === null) {
    if (on) throw new ValidationError('Starting with the machine is not available on this system.');
    return;
  }
  await setAutostart(on, startPlan);
};
// For trying the updater against a pretend list of releases on this machine; an
// address anywhere else is not taken.
const pretendUrl = process.env.PROTEUS_RELEASES_URL ?? '';
const pretend = /^http:\/\/127\.0\.0\.1:\d+\//.test(pretendUrl) ? new URL(pretendUrl) : null;
const updater = new Updater({
  managerDir, dataDir: store.dataDir,
  // A pretend list is signed with a pretend key, which the trial names: the real
  // keys' owner signs real releases only.
  ...(pretend ? {
    releasesUrl: pretend.href, downloadPrefix: `${pretend.origin}/`,
    ...(process.env.PROTEUS_RELEASE_KEY ? { releaseKeys: [process.env.PROTEUS_RELEASE_KEY] } : {}),
  } : {}),
});
const server = createApiServer({ store, launcher, uiDir: join(managerDir, 'ui'), updater, quit: () => void shutdown(true) });

// With no kernel chosen yet, or one that is no longer there (the folder was moved),
// use the one shipped next to the manager.
const settings = await store.getSettings();
if (settings.startWithMachine && startPlan !== null) await setAutostart(true, startPlan).catch(() => {});
if (settings.kernelPath === '' || !existsSync(settings.kernelPath)) {
  const kernel = findKernel(managerDir);
  if (kernel !== undefined) {
    await store.updateSettings({ kernelPath: kernel });
    console.log(`Kernel: ${kernel}`);
  }
}

// Started a second time (the shortcut was clicked again, perhaps because the window
// was closed while profiles kept running): Proteus is already there, so show its
// window again instead of failing over the port.
server.once('error', async (error: NodeJS.ErrnoException) => {
  const url = `http://127.0.0.1:${parsePort(argv)}`;
  let already = false;
  if (error.code === 'EADDRINUSE') {
    try {
      const health = await (await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(3000) })).json() as { name?: string };
      already = health.name === 'proteus-manager';
    } catch { /* Something else has the port. */ }
  }
  if (!already) {
    console.error(error.code === 'EADDRINUSE'
        ? `Port ${parsePort(argv)} is used by another program. Start Proteus with --port <n> to use another one.`
        : `Proteus could not start: ${error.message}`);
    process.exit(1);
  }
  console.log(`Proteus is already running at ${url}.`);
  if (argv.includes('--open')) {
    const { kernelPath } = await store.getSettings();
    if (kernelPath !== '' && existsSync(kernelPath)) {
      spawn(kernelPath, appWindowArguments(url, store.dataDir), { stdio: 'ignore', detached: true })
          .on('error', () => openInBrowser(url)).unref();
    } else {
      openInBrowser(url);
    }
  } else if (argv.includes('--open-browser')) {
    openInBrowser(url);
  }
  // Leave time for the window's process to be on its way before this one ends.
  setTimeout(() => process.exit(0), 500);
});

// Loopback only: the API has no login and must not be reachable from the network.
server.listen(parsePort(argv), '127.0.0.1', () => {
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : DEFAULT_PORT;
  const url = `http://127.0.0.1:${port}`;
  console.log(`Proteus manager listening on ${url}`);
  console.log(`Data directory: ${store.dataDir}`);
  if (argv.includes('--open')) void openWindow(url);
  else if (argv.includes('--open-browser')) openInBrowser(url);
  void lookForUpdates();
});

/**
 * What an earlier update left is cleared, and - in a release folder, unless turned off -
 * GitHub is asked now and once a day whether there is a newer release. The window
 * shows what was found; nothing is fetched until the user says so.
 */
async function lookForUpdates(): Promise<void> {
  await updater.tidy().catch(() => {});
  const look = async () => {
    if (updater.current === null || !(await store.getSettings()).autoUpdateCheck) return;
    const report = await updater.check().catch(() => null);
    if (report?.newer) console.log(`${report.message} Update from the Proteus window.`);
  };
  await look();
  setInterval(() => void look(), 24 * 60 * 60 * 1000).unref();
}

function openInBrowser(url: string): void {
  const [program, ...args] = openCommand(url);
  // Best effort: without a desktop there is nothing to open, and the address is printed above.
  spawn(program, args, { stdio: 'ignore', detached: true }).on('error', () => {}).unref();
}

/**
 * Shows the manager in a window of its own, drawn by the kernel, so that Proteus
 * looks and behaves like an application. Falls back to the user's browser when there
 * is no kernel yet.
 */
async function openWindow(url: string): Promise<void> {
  const { kernelPath } = await store.getSettings();
  if (kernelPath === '' || !existsSync(kernelPath)) return openInBrowser(url);
  await allowSandboxToReadKernel(kernelPath);
  const child = spawn(kernelPath, appWindowArguments(url, store.dataDir), { stdio: 'ignore' });
  child.once('error', () => openInBrowser(url));
  // Closing the window ends Proteus, unless profiles are still running: those are
  // the user's work, and stay until this program itself is stopped.
  child.once('exit', () => {
    if (shuttingDown) return;
    const running = launcher.runningCount();
    if (running === 0) void shutdown();
    else console.log(`The Proteus window was closed; ${running} profile(s) keep running. Press Ctrl+C here to stop them.`);
  });
}

let shuttingDown = false;
async function shutdown(now = false): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log('Stopping running profiles ...');
  await launcher.stopAll();
  server.close(() => process.exit(0));
  // For an update the window is still open and holds its connections: they are cut.
  if (now) server.closeAllConnections();
}
process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());

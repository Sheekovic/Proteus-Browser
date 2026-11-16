// Entry point: `node src/main.ts [--port 5310] [--open | --open-browser]`
//   --open           also shows the manager in a window of its own
//   --open-browser   also opens the manager in the user's usual browser

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { appWindowArguments, findKernel, openCommand } from './bundled.ts';
import { Launcher } from './launcher.ts';
import { createApiServer } from './server.ts';
import { Store } from './store.ts';
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
const server = createApiServer({ store, launcher, uiDir: join(managerDir, 'ui') });

// With no kernel chosen yet, or one that is no longer there (the folder was moved),
// use the one shipped next to the manager.
const settings = await store.getSettings();
if (settings.kernelPath === '' || !existsSync(settings.kernelPath)) {
  const kernel = findKernel(managerDir);
  if (kernel !== undefined) {
    await store.updateSettings({ kernelPath: kernel });
    console.log(`Kernel: ${kernel}`);
  }
}

// Loopback only: the API has no login and must not be reachable from the network.
server.listen(parsePort(argv), '127.0.0.1', () => {
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : DEFAULT_PORT;
  const url = `http://127.0.0.1:${port}`;
  console.log(`Proteus manager listening on ${url}`);
  console.log(`Data directory: ${store.dataDir}`);
  if (argv.includes('--open')) void openWindow(url);
  else if (argv.includes('--open-browser')) openInBrowser(url);
});

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
async function shutdown(): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log('Stopping running profiles ...');
  await launcher.stopAll();
  server.close(() => process.exit(0));
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

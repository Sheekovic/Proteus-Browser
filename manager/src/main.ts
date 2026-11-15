// Entry point: `node src/main.ts [--port 5310]`

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Launcher } from './launcher.ts';
import { createApiServer } from './server.ts';
import { Store } from './store.ts';

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

const store = new Store();
const launcher = new Launcher(store);
const uiDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'ui');
const server = createApiServer({ store, launcher, uiDir });

// Loopback only: the API has no login and must not be reachable from the network.
server.listen(parsePort(process.argv.slice(2)), '127.0.0.1', () => {
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : DEFAULT_PORT;
  console.log(`Proteus manager listening on http://127.0.0.1:${port}`);
  console.log(`Data directory: ${store.dataDir}`);
});

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

// End-to-end check that a running profile follows its proxy to a new exit.
//
// Starts the manager with a lookup service and a proxy of its own, starts a profile on
// the real kernel, reads the time zone and languages in a page, makes the proxy "come
// out" somewhere else, and reads the same page again: it has to be in the new place,
// in the same browser, with nothing started again. Nothing leaves this machine.
//
// usage: node move.mjs <kernel executable> [extra kernel args...]
//   e.g. node move.mjs /opt/proteus/chromium/src/out/Linux/chrome --headless=new --no-sandbox --disable-gpu
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer as createHttpServer } from 'node:http';
import { connect as netConnect, createServer as createNetServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const [kernelPath, ...extraArgs] = process.argv.slice(2);
if (!kernelPath) {
  console.error('usage: move.mjs <kernel executable> [extra kernel args...]');
  process.exit(2);
}
const managerDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const dataDir = mkdtempSync(join(tmpdir(), 'proteus-move-e2e-'));
const PORT = 5317;
const base = `http://127.0.0.1:${PORT}`;

let failures = 0;
function check(name, actual, expected) {
  if (actual === expected) console.log(`ok   ${name}`);
  else { console.log(`FAIL ${name}\n       got:      ${actual}\n       expected: ${expected}`); failures++; }
}
async function api(method, path, body) {
  const response = await fetch(base + path, {
    method,
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : undefined;
  if (!response.ok) throw new Error(`${method} ${path}: ${response.status} ${text}`);
  return data;
}

// Documentation-only addresses (RFC 5737).
const NEW_YORK = { ip: '203.0.113.10', timezone: 'America/New_York', country: 'US', latitude: 40.71, longitude: -74.0 };
const BERLIN = { ip: '198.51.100.20', timezone: 'Europe/Berlin', country: 'DE', latitude: 52.52, longitude: 13.4 };
let exit = NEW_YORK;
const service = createHttpServer((_request, response) => {
  response.setHeader('Content-Type', 'application/json');
  response.end(JSON.stringify(exit));
});
await new Promise((resolve) => service.listen(0, '127.0.0.1', resolve));
// An HTTP proxy that tunnels to wherever on this machine it is asked.
const proxy = createNetServer((socket) => {
  socket.on('error', () => {});
  socket.once('data', (data) => {
    const target = /^CONNECT (\S+)/.exec(data.toString('latin1'))?.[1] ?? '';
    const remote = netConnect(Number(target.split(':').pop()), '127.0.0.1', () => {
      socket.write('HTTP/1.1 200 Connection established\r\n\r\n');
      socket.pipe(remote); remote.pipe(socket);
    });
    remote.on('error', () => socket.destroy());
  });
});
await new Promise((resolve) => proxy.listen(0, '127.0.0.1', resolve));

const manager = spawn(process.execPath, [join(managerDir, 'src', 'main.ts'), '--port', String(PORT)],
    { env: { ...process.env, PROTEUS_HOME: dataDir }, stdio: 'ignore' });
let id;
try {
  for (let i = 0; i < 100; i++) { try { await api('GET', '/api/health'); break; } catch { await delay(100); } }
  // Nobody looks while the profile runs: the proxy check below is what finds the move.
  await api('PUT', '/api/settings', {
    kernelPath, extraArgs, autoUpdateCheck: false, exitWatchMinutes: 0, exitCacheMinutes: 0,
    exitLookupUrl: `http://127.0.0.1:${service.address().port}/json`,
  });
  const profile = await api('POST', '/api/profiles', {
    name: 'Mover', os: 'windows', proxy: { type: 'http', host: '127.0.0.1', port: proxy.address().port },
  });
  id = profile.id;
  const started = await api('POST', `/api/profiles/${id}/start`, {});
  check('started at the first exit', started.proxyExit?.ip, NEW_YORK.ip);

  const tab = await api('POST', `/api/profiles/${id}/tabs`, { url: 'about:blank' });
  const tabId = tab.id ?? tab.tabId ?? tab.targetId;
  const read = async () => (await api('POST', `/api/profiles/${id}/tabs/${tabId}/evaluate`, { expression:
      `(window.changes ??= (addEventListener('languagechange', () => window.changes.n++), { n: 0 }),
        JSON.stringify([Intl.DateTimeFormat().resolvedOptions().timeZone, new Date(2026, 0, 15, 12).getTimezoneOffset(),
                        navigator.languages.join(','), window.changes.n]))` })).value;
  check('the page is in New York', await read(), JSON.stringify(['America/New_York', 300, 'en-US,en', 0]));

  // The proxy comes out in Berlin now; a program that made it do so checks the proxy.
  exit = BERLIN;
  const checked = await api('POST', '/api/proxy/check', { profileId: id });
  check('the check finds the new exit', checked.ip, BERLIN.ip);
  const status = await api('GET', `/api/profiles/${id}/status`);
  check('the profile is matched to the new exit', status.proxyExit?.ip, BERLIN.ip);
  check('it says it was moved', typeof status.exitMovedAt, 'string');
  check('there is nothing to restart for', status.exitNow, undefined);
  check('it is the same browser', status.pid, started.pid);
  await delay(500);
  check('the same page is in Berlin', await read(), JSON.stringify(['Europe/Berlin', -60, 'de-DE,de,en-US,en', 1]));
} catch (error) {
  console.log(`FAIL ${error.stack ?? error}`);
  failures++;
} finally {
  if (id) await api('POST', `/api/profiles/${id}/stop`, {}).catch(() => {});
  manager.kill('SIGTERM');
  service.close();
  proxy.close();
  await delay(1500);
  rmSync(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
}
console.log(failures === 0 ? 'E2E-OK' : `E2E-FAIL (${failures})`);
process.exit(failures === 0 ? 0 : 1);

// A profile behind a proxy starts as a browser of the place its proxy comes out in:
// time zone, languages, position and WebRTC address, or it does not start.

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer as createHttpServer } from 'node:http';
import { createServer, connect } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { Launcher } from '../src/launcher.ts';
import { Store } from '../src/store.ts';

const here = dirname(fileURLToPath(import.meta.url));
const closers: (() => void)[] = [];
after(() => { for (const close of closers) close(); });

test('everything a page can compare with the address is the exit’s, or the profile does not start', async () => {
  let answer: object = { ip: '203.0.113.50', timezone: 'Europe/Berlin', country_code: 'DE', latitude: 52.52, longitude: 13.405 };
  const service = createHttpServer((_request, response) => {
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify(answer));
  });
  await new Promise<void>((resolve) => service.listen(0, '127.0.0.1', resolve));
  closers.push(() => service.close());
  const lookup = `http://127.0.0.1:${(service.address() as { port: number }).port}/json`;

  // An HTTP proxy that tunnels to wherever it is asked.
  const proxyServer = createServer((socket) => {
    socket.on('error', () => {});
    socket.once('data', (data) => {
      const target = /^CONNECT (\S+)/.exec(data.toString('latin1'))?.[1] ?? '';
      const remote = connect(Number(target.split(':').pop()), '127.0.0.1', () => {
        socket.write('HTTP/1.1 200 Connection established\r\n\r\n');
        socket.pipe(remote); remote.pipe(socket);
      });
      remote.on('error', () => socket.destroy());
    });
  });
  await new Promise<void>((resolve) => proxyServer.listen(0, '127.0.0.1', resolve));
  closers.push(() => proxyServer.close());
  const proxy = { type: 'http' as const, host: '127.0.0.1', port: (proxyServer.address() as { port: number }).port };

  const dir = await mkdtemp(join(tmpdir(), 'proteus-match-'));
  const store = new Store(dir);
  const launcher = new Launcher(store, (_kernel, args) =>
    spawn(process.execPath, [join(here, 'stub-kernel.mjs'), ...args], { stdio: 'ignore' }), async () => true);
  const configOf = async (id: string) => JSON.parse(await readFile(join(store.profileDir(id), 'kernel.json'), 'utf8'));
  try {
    await writeFile(join(dir, 'kernel'), '');
    await store.updateSettings({ kernelPath: join(dir, 'kernel'), exitLookupUrl: lookup, exitWatchMinutes: 0, exitCacheMinutes: 0 });

    // A new profile is matched without being told to.
    const profile = await store.createProfile({ os: 'windows', proxy });
    assert.equal(profile.matchProxy, true);
    assert.deepEqual([profile.timezone, profile.languages, profile.geolocation], ['', [], null]);
    await launcher.start(profile);
    const config = await configOf(profile.id);
    assert.equal(config.timezone, 'Europe/Berlin');
    assert.deepEqual(config.languages, ['de-DE', 'de', 'en-US', 'en']);
    assert.equal(config.webRtcPublicIp, '203.0.113.50');
    assert.ok(Math.abs(config.geolocation.latitude - 52.52) < 0.1 && Math.abs(config.geolocation.longitude - 13.405) < 0.1,
        'a spot of its own near the exit’s city');
    await delay(300);
    await launcher.stop(profile.id);
    assert.deepEqual((await store.getProfile(profile.id)).languages, [], 'the exit’s languages are not saved as the profile’s');

    // The proxy comes out somewhere else: the next start is of that place.
    answer = { ip: '198.51.100.7', timezone: 'America/Sao_Paulo', country_code: 'BR', latitude: -23.55, longitude: -46.63 };
    await launcher.start(await store.getProfile(profile.id));
    const moved = await configOf(profile.id);
    assert.deepEqual([moved.timezone, moved.languages, moved.webRtcPublicIp],
        ['America/Sao_Paulo', ['pt-BR', 'pt', 'en-US', 'en'], '198.51.100.7']);
    await launcher.stop(profile.id);

    // An exit whose time zone nobody tells: the browser would show this machine's.
    answer = { ip: '198.51.100.7' };
    await assert.rejects(launcher.start(await store.getProfile(profile.id)), /not its time zone/);
    assert.equal(launcher.status(profile.id).state, 'stopped');
    // With a time zone of its own the profile starts.
    const own = await store.updateProfile(profile.id, { timezone: 'Asia/Tokyo' });
    await launcher.start(own);
    assert.equal((await configOf(profile.id)).timezone, 'Asia/Tokyo');
    await launcher.stop(profile.id);
  } finally {
    await launcher.stopAll();
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});

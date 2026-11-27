// A proxy that starts coming out somewhere else moves the running browser there.

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

import { Launcher, placeOf } from '../src/launcher.ts';
import { Store } from '../src/store.ts';

const here = dirname(fileURLToPath(import.meta.url));
const closers: (() => void)[] = [];
after(() => { for (const close of closers) close(); });

const TOKYO = { ip: '203.0.113.50', timezone: 'Asia/Tokyo', country: 'JP', latitude: 35.68, longitude: 139.69 };
const PARIS = { ip: '198.51.100.7', timezone: 'Europe/Paris', country: 'FR', latitude: 48.85, longitude: 2.35 };

/** A lookup service that says `answer.now`, an HTTP proxy to reach it through, and a store. */
async function setUp(): Promise<{ answer: { now: object }; lookup: string; proxyPort: number; dir: string; store: Store }> {
  const answer = { now: TOKYO as object };
  const service = createHttpServer((_request, response) => {
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify(answer.now));
  });
  await new Promise<void>((resolve) => service.listen(0, '127.0.0.1', resolve));
  closers.push(() => service.close());
  const lookup = `http://127.0.0.1:${(service.address() as { port: number }).port}/json`;

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

  const dir = await mkdtemp(join(tmpdir(), 'proteus-move-'));
  const store = new Store(dir);
  await writeFile(join(dir, 'kernel'), '');
  return { answer, lookup, proxyPort: (proxyServer.address() as { port: number }).port, dir, store };
}

const until = async (done: () => boolean): Promise<void> => {
  for (let i = 0; i < 100 && !done(); i++) await delay(50);
};

test('a running profile follows its proxy to a new exit without a restart', async () => {
  const { answer, lookup, proxyPort, dir, store } = await setUp();
  const launcher = new Launcher(store, (_kernel, args) =>
    spawn(process.execPath, [join(here, 'stub-kernel.mjs'), '--stub-moves', ...args], { stdio: 'ignore' }), async () => true);
  try {
    // A look every 60 milliseconds, so the test does not wait minutes.
    await store.updateSettings({ kernelPath: join(dir, 'kernel'), exitLookupUrl: lookup, exitWatchMinutes: 0.001 });
    const profile = await store.createProfile({ os: 'windows', proxy: { type: 'http', host: '127.0.0.1', port: proxyPort } });
    const folder = store.profileDir(profile.id);
    // Left by an earlier run.
    await writeFile(join(folder, 'place.json'), '{"id":"old","timezone":"Europe/Paris"}');

    const started = await launcher.start(profile);
    assert.equal(started.proxyExit?.ip, TOKYO.ip);
    assert.equal(started.exitMovedAt, undefined);
    const config = JSON.parse(await readFile(join(folder, 'kernel.json'), 'utf8'));
    assert.equal(config.timezone, 'Asia/Tokyo');
    assert.equal(config.languages[0], 'ja');
    await assert.rejects(readFile(join(folder, 'place.json')), 'a place of an earlier run is removed at the start');

    answer.now = PARIS;
    await until(() => launcher.status(profile.id).exitMovedAt !== undefined);
    const moved = launcher.status(profile.id);
    assert.equal(moved.proxyExit?.ip, PARIS.ip, 'the exit the browser is matched to is the new one');
    assert.equal(moved.proxyExit?.timezone, 'Europe/Paris');
    assert.equal(moved.exitNow, undefined, 'nothing to restart for');
    assert.ok(moved.exitMovedAt);
    assert.equal(moved.pid, started.pid, 'the same browser');

    const place = JSON.parse(await readFile(join(folder, 'place.json'), 'utf8'));
    assert.equal(place.timezone, 'Europe/Paris');
    assert.equal(place.webRtcPublicIp, PARIS.ip);
    assert.equal(place.languages[0], 'fr-FR');
    assert.ok(Math.abs(place.geolocation.latitude - PARIS.latitude) < 1, 'a position near the new exit');
    assert.equal(await readFile(join(folder, 'place.taken'), 'utf8'), place.id);

    // And back again: a profile moves as often as its proxy does.
    answer.now = TOKYO;
    await until(() => launcher.status(profile.id).proxyExit?.ip === TOKYO.ip);
    assert.equal(launcher.status(profile.id).proxyExit?.ip, TOKYO.ip);
    assert.equal(JSON.parse(await readFile(join(folder, 'place.json'), 'utf8')).timezone, 'Asia/Tokyo');
    assert.equal(launcher.status(profile.id).exitNow, undefined);
  } finally {
    await launcher.stopAll();
    await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
});

test('a proxy check moves the running profile at once, and what the user set stays', async () => {
  const { answer, lookup, proxyPort, dir, store } = await setUp();
  const launcher = new Launcher(store, (_kernel, args) =>
    spawn(process.execPath, [join(here, 'stub-kernel.mjs'), '--stub-moves', ...args], { stdio: 'ignore' }), async () => true);
  try {
    // Nobody looks while the profile runs: only the check does.
    await store.updateSettings({ kernelPath: join(dir, 'kernel'), exitLookupUrl: lookup, exitWatchMinutes: 0, exitCacheMinutes: 0 });
    const proxy = { type: 'http' as const, host: '127.0.0.1', port: proxyPort };
    const profile = await store.createProfile({ os: 'windows', proxy, languages: ['en-GB', 'en'] });
    const folder = store.profileDir(profile.id);
    assert.equal((await launcher.start(profile)).proxyExit?.ip, TOKYO.ip);

    answer.now = PARIS;
    await launcher.noteExit(proxy, PARIS);
    const moved = launcher.status(profile.id);
    assert.equal(moved.proxyExit?.ip, PARIS.ip, 'moved by the time the check returns');
    assert.ok(moved.exitMovedAt);
    const place = JSON.parse(await readFile(join(folder, 'place.json'), 'utf8'));
    assert.equal(place.timezone, 'Europe/Paris');
    assert.deepEqual(place.languages, ['en-GB', 'en'], 'languages the user chose do not follow the proxy');

    // An exit whose time zone nobody can tell is not a place to move to.
    await launcher.noteExit(proxy, { ip: '192.0.2.9', timezone: '' });
    const lost = launcher.status(profile.id);
    assert.equal(lost.proxyExit?.ip, PARIS.ip, 'the browser stays where it was');
    assert.equal(lost.exitNow?.ip, '192.0.2.9', 'and the status says where the proxy is now');
    assert.equal(JSON.parse(await readFile(join(folder, 'place.json'), 'utf8')).timezone, 'Europe/Paris');
  } finally {
    await launcher.stopAll();
    await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
});

test('what a new exit does not tell stays as it was, except the address', () => {
  const before = placeOf({ timezone: 'Asia/Tokyo', languages: ['ja', 'en'], webRtcPublicIp: '203.0.113.50',
                           geolocation: { latitude: 35, longitude: 139, accuracy: 50 } });
  assert.deepEqual(placeOf({ timezone: 'Europe/Paris' }, before), {
    timezone: 'Europe/Paris', languages: ['ja', 'en'], webRtcPublicIp: '',
    geolocation: { latitude: 35, longitude: 139, accuracy: 50 },
  });
  assert.deepEqual(placeOf({}), { timezone: '', languages: [], webRtcPublicIp: '' });
});

// A proxy's exit changing, or going away, while a profile runs.

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer as createHttpServer } from 'node:http';
import { createServer, connect } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { Launcher } from '../src/launcher.ts';
import { ValidationError } from '../src/profile.ts';
import { Store } from '../src/store.ts';

const here = dirname(fileURLToPath(import.meta.url));
const closers: (() => void)[] = [];
after(() => { for (const close of closers) close(); });

test('a changed or lost exit is noticed while the profile runs', async () => {
  // The lookup service says whatever `answer` holds at the moment.
  let answer: object | number = { ip: '203.0.113.50', timezone: 'Asia/Tokyo' };
  const service = createHttpServer((_request, response) => {
    if (typeof answer === 'number') { response.statusCode = answer; response.end(); return; }
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
  const proxyPort = (proxyServer.address() as { port: number }).port;

  const dir = await mkdtemp(join(tmpdir(), 'proteus-watch-'));
  const store = new Store(dir);
  const launcher = new Launcher(store, (_kernel, args) =>
    spawn(process.execPath, [join(here, 'stub-kernel.mjs'), ...args], { stdio: 'ignore' }), async () => true);
  try {
    await writeFile(join(dir, 'kernel'), '');
    // A look every 60 milliseconds, so the test does not wait minutes.
    await store.updateSettings({ kernelPath: join(dir, 'kernel'), exitLookupUrl: lookup, exitWatchMinutes: 0.001 });
    const profile = await store.createProfile({ proxy: { type: 'http', host: '127.0.0.1', port: proxyPort } });
    const started = await launcher.start(profile);
    assert.equal(started.proxyExit?.ip, '203.0.113.50');
    assert.equal(started.exitNow, undefined);

    await delay(300);
    assert.equal(launcher.status(profile.id).exitNow, undefined, 'the same exit is not a change');

    answer = { ip: '198.51.100.7', timezone: 'Europe/Paris' };
    await delay(400);
    const moved = launcher.status(profile.id);
    assert.equal(moved.exitNow?.ip, '198.51.100.7');
    assert.equal(moved.exitNow?.timezone, 'Europe/Paris');
    assert.equal(moved.proxyExit?.ip, '203.0.113.50', 'what the browser was matched to is still reported');
    const since = moved.exitNow?.since;

    await delay(300);
    assert.equal(launcher.status(profile.id).exitNow?.since, since, 'the moment of the change is kept, not renewed at each look');

    answer = { ip: '203.0.113.50', timezone: 'Asia/Tokyo' };
    await delay(400);
    assert.equal(launcher.status(profile.id).exitNow, undefined, 'back at the first exit: nothing to report');

    // A proxy in trouble is asked a few times before it is called down, which takes seconds.
    const until = async (done: () => boolean): Promise<void> => {
      for (let i = 0; i < 100 && !done(); i++) await delay(100);
    };
    answer = 503;
    await until(() => launcher.status(profile.id).exitProblem !== undefined);
    assert.match(launcher.status(profile.id).exitProblem ?? '', /503/);
    answer = { ip: '203.0.113.50', timezone: 'Asia/Tokyo' };
    await until(() => launcher.status(profile.id).exitProblem === undefined);
    assert.equal(launcher.status(profile.id).exitProblem, undefined);

    await launcher.stop(profile.id);
    assert.equal(launcher.status(profile.id).exitNow, undefined);
  } finally {
    await launcher.stopAll();
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});

test('the watch interval is a setting', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'proteus-watch-'));
  try {
    const store = new Store(dir);
    assert.equal((await store.getSettings()).exitWatchMinutes, 10);
    assert.equal((await store.updateSettings({ exitWatchMinutes: 0 })).exitWatchMinutes, 0);
    for (const bad of [-1, 2000, '5', null]) {
      await assert.rejects(store.updateSettings({ exitWatchMinutes: bad as never }), ValidationError);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

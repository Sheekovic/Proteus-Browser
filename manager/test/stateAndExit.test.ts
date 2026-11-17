// One shape for a profile's state in every reply; which address a proxy comes out on,
// wherever profiles are looked at; and starting without waiting for a known exit.

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer as createHttpServer, type Server } from 'node:http';
import { type AddressInfo, connect, createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { ExitMemory, proxyKey } from '../src/exitMemory.ts';
import { Launcher, LaunchError } from '../src/launcher.ts';
import { ValidationError } from '../src/profile.ts';
import { createApiServer } from '../src/server.ts';
import { Store } from '../src/store.ts';

const here = dirname(fileURLToPath(import.meta.url));
const TOKYO = { ip: '203.0.113.50', timezone: 'Asia/Tokyo' };
const PARIS = { ip: '198.51.100.7', timezone: 'Europe/Paris' };

// A lookup service whose answer the test sets, which counts how often it is asked and
// can be made to keep callers waiting.
let answer: object = TOKYO;
let hits = 0;
let hold: Promise<void> = Promise.resolve();
let lookup: string;
let proxyPort: number;
const closers: (() => void)[] = [];

let dir: string;
let store: Store;
let launcher: Launcher;
let server: Server;
let base: string;

before(async () => {
  const service = createHttpServer(async (_request, response) => {
    hits++;
    await hold;
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify(answer));
  });
  await new Promise<void>((resolve) => service.listen(0, '127.0.0.1', resolve));
  closers.push(() => { service.closeAllConnections(); service.close(); });
  lookup = `http://127.0.0.1:${(service.address() as AddressInfo).port}/json`;

  // An HTTP proxy that tunnels to wherever it is asked.
  const proxy = createServer((socket) => {
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
  await new Promise<void>((resolve) => proxy.listen(0, '127.0.0.1', resolve));
  closers.push(() => proxy.close());
  proxyPort = (proxy.address() as AddressInfo).port;

  dir = await mkdtemp(join(tmpdir(), 'proteus-state-'));
  store = new Store(dir);
  launcher = new Launcher(store, (_kernel, args) =>
      spawn(process.execPath, [join(here, 'stub-kernel.mjs'), ...args], { stdio: 'ignore' }), async () => true,
      async () => ({}));
  await writeFile(join(dir, 'kernel'), '');
  await store.updateSettings({ kernelPath: join(dir, 'kernel'), exitLookupUrl: lookup, exitWatchMinutes: 0 });
  server = createApiServer({ store, launcher, uiDir: join(here, '..', 'ui') });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  await launcher.stopAll();
  await new Promise((resolve) => server.close(resolve));
  for (const close of closers) close();
  await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

async function api(method: string, path: string, body?: unknown) {
  const response = await fetch(base + path, {
    method, headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : undefined };
}

async function tool(name: string, args: Record<string, unknown> = {}) {
  const reply = (await api('POST', '/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } })).body;
  return JSON.parse(reply.result.content[0].text);
}

const until = async (done: () => boolean | Promise<boolean>): Promise<void> => {
  for (let i = 0; i < 100 && !(await done()); i++) await delay(50);
};

/** A proxy of its own for each test (the user name tells them apart), so what one remembers does not reach another. */
const proxyNamed = (username: string) => ({ type: 'http' as const, host: '127.0.0.1', port: proxyPort, username, password: 'secret' });

test('every reply about a profile reports its state in one shape', async () => {
  const created = (await api('POST', '/api/profiles', { name: 'Shape', os: 'windows' })).body;
  const id = created.id;

  /** `state` is the plain word, `status` the details, and they agree. */
  const shaped = (reply: any, state: string, where: string): void => {
    assert.equal(reply.state, state, where);
    assert.equal(typeof reply.status, 'object', where);
    assert.equal(reply.status.state, state, where);
  };
  shaped(created, 'stopped', 'create');
  shaped((await api('GET', '/api/profiles')).body.find((p: any) => p.id === id), 'stopped', 'list');
  shaped((await api('GET', `/api/profiles/${id}`)).body, 'stopped', 'one profile');
  shaped((await api('GET', `/api/profiles/${id}/status`)).body, 'stopped', 'status');
  shaped((await api('PATCH', `/api/profiles/${id}`, { notes: 'x' })).body, 'stopped', 'edit');

  const started = (await api('POST', `/api/profiles/${id}/start`, {})).body;
  shaped(started, 'running', 'start');
  for (const [where, reply] of [
    ['list', (await api('GET', '/api/profiles')).body.find((p: any) => p.id === id)],
    ['one profile', (await api('GET', `/api/profiles/${id}`)).body],
    ['status', (await api('GET', `/api/profiles/${id}/status`)).body],
  ] as const) {
    shaped(reply, 'running', where);
    // A client may read the details in the same place everywhere.
    assert.equal(reply.status.debuggerUrl, 'http://127.0.0.1:45678', where);
    assert.equal(reply.status.pid, started.status.pid, where);
  }
  // Clients written for the earlier replies still find what they read: the details
  // at the top level of the status, start and stop replies.
  assert.equal(started.debuggerUrl, 'http://127.0.0.1:45678');
  assert.equal(typeof started.pid, 'number');
  assert.equal((await api('GET', `/api/profiles/${id}/status`)).body.debuggerUrl, 'http://127.0.0.1:45678');
  assert.equal(started.status.status, undefined, 'the details are not nested twice');

  // The MCP tools use the same shape.
  shaped(await tool('get_profile', { id }), 'running', 'get_profile');
  assert.equal((await tool('list_profiles')).find((p: any) => p.id === id).state, 'running');
  shaped(await tool('stop_profile', { id }), 'stopped', 'stop_profile');
  shaped(await tool('start_profile', { id }), 'running', 'start_profile');
  shaped((await api('POST', `/api/profiles/${id}/stop`, {})).body, 'stopped', 'stop');
  shaped((await api('POST', `/api/profiles/${id}/duplicate`, {})).body, 'stopped', 'duplicate');
  shaped((await api('POST', '/api/profiles/bulk', { count: 1, name: 'Bulk' })).body[0], 'stopped', 'bulk');
});

test('the address a proxy comes out on is shown in the list and for the profile, running or stopped', async () => {
  answer = TOKYO;
  const id = (await api('POST', '/api/profiles', { name: 'Exit', proxy: proxyNamed('shown') })).body.id;
  assert.equal((await api('GET', `/api/profiles/${id}`)).body.status.lastProxyExit, undefined, 'never asked yet');

  const started = (await api('POST', `/api/profiles/${id}/start`, {})).body;
  assert.deepEqual(started.status.proxyExit, TOKYO, 'in the start reply');
  assert.deepEqual(started.proxyExit, TOKYO);
  assert.ok(!Number.isNaN(Date.parse(started.status.exitSeenAt)));
  assert.deepEqual((await api('GET', '/api/profiles')).body.find((p: any) => p.id === id).status.proxyExit, TOKYO, 'in the list');
  assert.deepEqual((await api('GET', `/api/profiles/${id}`)).body.status.proxyExit, TOKYO, 'for the profile');
  assert.deepEqual((await tool('list_profiles')).find((p: any) => p.id === id).proxyExit, TOKYO, 'in the MCP list');
  assert.deepEqual((await tool('get_profile', { id })).status.proxyExit, TOKYO);

  // Stopped, both still say where it last came out, and when.
  await api('POST', `/api/profiles/${id}/stop`, {});
  for (const reply of [(await api('GET', '/api/profiles')).body.find((p: any) => p.id === id),
                       (await api('GET', `/api/profiles/${id}`)).body, await tool('get_profile', { id })]) {
    assert.equal(reply.status.proxyExit, undefined);
    assert.equal(reply.status.lastProxyExit.ip, TOKYO.ip);
    assert.equal(reply.status.lastProxyExit.timezone, TOKYO.timezone);
    assert.ok(!Number.isNaN(Date.parse(reply.status.lastProxyExit.at)));
  }
  assert.equal((await tool('list_profiles')).find((p: any) => p.id === id).lastProxyExit.ip, TOKYO.ip);
  // A profile without a proxy has neither.
  const direct = (await api('POST', '/api/profiles', { name: 'Direct', matchProxy: false })).body;
  assert.equal(direct.status.lastProxyExit, undefined);
});

test('a profile that is not matched asks nobody, and shows what a proxy check found', async () => {
  answer = PARIS;
  const proxy = proxyNamed('unmatched');
  const id = (await api('POST', '/api/profiles', { name: 'Unmatched', proxy, matchProxy: false })).body.id;
  const before = hits;
  const first = (await api('POST', `/api/profiles/${id}/start`, {})).body;
  assert.equal(first.status.proxyExit, undefined, 'nothing is known, and nothing was asked');
  await api('POST', `/api/profiles/${id}/stop`, {});
  assert.equal(hits, before);

  // Checking the proxy is asking; what it finds is remembered for the profile.
  const check = (await api('POST', '/api/proxy/check', { profileId: id })).body;
  assert.equal(check.ip, PARIS.ip);
  assert.equal((await api('GET', `/api/profiles/${id}`)).body.status.lastProxyExit.ip, PARIS.ip);
  const asked = hits;
  const second = (await api('POST', `/api/profiles/${id}/start`, {})).body;
  assert.equal(second.status.proxyExit.ip, PARIS.ip);
  const config = JSON.parse(await readFile(join(store.profileDir(id), 'kernel.json'), 'utf8'));
  assert.ok(!('timezone' in config), 'shown, but the browser is not matched to it');
  await api('POST', `/api/profiles/${id}/stop`, {});
  assert.equal(hits, asked, 'and the start itself still asks nobody');
});

test('a start does not wait for an exit seen twice, and notices when it has moved after all', async () => {
  answer = TOKYO;
  const profile = await store.createProfile({ name: 'Fast', proxy: proxyNamed('fast') });
  const kernelConfig = async () => JSON.parse(await readFile(join(store.profileDir(profile.id), 'kernel.json'), 'utf8'));

  // First start: nothing is known, so the proxy is asked before the browser starts,
  // and once more while it comes up.
  let before = hits;
  assert.deepEqual((await launcher.start(profile)).proxyExit, TOKYO);
  await until(() => hits === before + 2);
  await launcher.stop(profile.id);
  assert.equal(hits, before + 2);

  // Second start: the service keeps everyone waiting, and the start returns anyway,
  // matched to the exit it remembers.
  let release = (): void => {};
  hold = new Promise((resolve) => { release = resolve; });
  before = hits;
  const status = await launcher.start(profile);
  assert.deepEqual(status.proxyExit, TOKYO);
  assert.equal((await kernelConfig()).timezone, 'Asia/Tokyo');
  assert.equal((await kernelConfig()).webRtcPublicIp, TOKYO.ip);
  assert.equal(launcher.status(profile.id).exitNow, undefined);

  // The look that ran meanwhile finds the proxy somewhere else: the profile says so.
  answer = PARIS;
  release();
  hold = Promise.resolve();
  await until(() => launcher.status(profile.id).exitNow !== undefined);
  assert.equal(hits, before + 1, 'one look, in the background');
  assert.equal(launcher.status(profile.id).exitNow?.ip, PARIS.ip);
  assert.deepEqual(launcher.status(profile.id).proxyExit, TOKYO, 'what the browser was matched to is still reported');
  await launcher.stop(profile.id);

  // An exit that moved is not trusted: the next start asks first again, and matches the new one.
  before = hits;
  assert.deepEqual((await launcher.start(profile)).proxyExit, PARIS);
  assert.equal((await kernelConfig()).timezone, 'Europe/Paris');
  assert.ok(hits >= before + 1);
  await launcher.stop(profile.id);
});

test('a proxy that fails, or whose password changed, is never started from memory', async () => {
  answer = TOKYO;
  const proxy = proxyNamed('strict');
  const profile = await store.createProfile({ proxy });
  await launcher.start(profile);
  await until(async () => (await new ExitMemory(join(dir, 'exits.json')).get(proxyKey(proxy)))?.confirmed === true);
  await launcher.stop(profile.id);

  // Another password is another login: nothing is remembered for it.
  assert.notEqual(proxyKey(proxy), proxyKey({ ...proxy, password: 'other' }));
  assert.equal(await new ExitMemory(join(dir, 'exits.json')).get(proxyKey({ ...proxy, password: 'other' })), undefined);
  assert.ok(!(await readFile(join(dir, 'exits.json'), 'utf8')).includes('secret'), 'the memory holds no password');

  // With the memory switched off, every start asks first, exactly once.
  await store.updateSettings({ exitCacheMinutes: 0 });
  try {
    const before = hits;
    await launcher.start(profile);
    await delay(150);
    await launcher.stop(profile.id);
    assert.equal(hits, before + 1);
    // And a proxy that cannot be asked still refuses to start.
    const dead = await store.createProfile({ proxy: { type: 'http', host: '127.0.0.1', port: 9 } });
    await assert.rejects(launcher.start(dead), LaunchError);
  } finally {
    await store.updateSettings({ exitCacheMinutes: 30 });
  }
});

test('what is remembered of an exit: seen twice, not too old, kept across restarts', async () => {
  const home = await mkdtemp(join(tmpdir(), 'proteus-exits-'));
  try {
    const file = join(home, 'exits.json');
    const memory = new ExitMemory(file);
    const t0 = Date.parse('2026-11-17T10:00:00Z');
    assert.equal(await memory.fresh('k', 30, t0), undefined);

    assert.equal((await memory.note('k', TOKYO, t0)).confirmed, false);
    assert.equal(await memory.fresh('k', 30, t0 + 1000), undefined, 'seen once is not enough');
    assert.equal((await memory.note('k', TOKYO, t0 + 2000)).confirmed, true);
    assert.deepEqual((await memory.fresh('k', 30, t0 + 60_000))?.exit, TOKYO);
    assert.equal(await memory.fresh('k', 30, t0 + 31 * 60_000), undefined, 'too old');
    assert.equal(await memory.fresh('k', 0, t0 + 3000), undefined, 'switched off');
    assert.deepEqual((await memory.get('k'))?.exit, TOKYO, 'still known as the last exit');

    // Another program instance finds it again.
    assert.deepEqual((await new ExitMemory(file).fresh('k', 30, t0 + 60_000))?.exit, TOKYO);
    // A new address starts over; an IPv6 exit is told apart by its IPv4 address.
    assert.equal((await memory.note('k', PARIS, t0 + 4000)).confirmed, false);
    assert.equal(await memory.fresh('k', 30, t0 + 5000), undefined);
    await memory.note('six', { ip: '2001:db8::1', ipv4: '192.0.2.1', timezone: '' }, t0);
    assert.equal((await memory.note('six', { ip: '2001:db8::2', ipv4: '192.0.2.1', timezone: '' }, t0)).confirmed, true);
    // A damaged file is the same as none.
    await writeFile(file, '{not json');
    assert.equal(await new ExitMemory(file).get('k'), undefined);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test('the memory time is a setting', async () => {
  const home = await mkdtemp(join(tmpdir(), 'proteus-exits-'));
  try {
    const local = new Store(home);
    assert.equal((await local.getSettings()).exitCacheMinutes, 30);
    assert.equal((await local.updateSettings({ exitCacheMinutes: 0 })).exitCacheMinutes, 0);
    for (const bad of [-1, 2000, '5', null]) {
      await assert.rejects(local.updateSettings({ exitCacheMinutes: bad as never }), ValidationError);
    }
    // Settings saved before it existed get the default.
    await writeFile(join(home, 'settings.json'), JSON.stringify({ kernelPath: '/k', exitWatchMinutes: 5 }));
    assert.deepEqual([(await local.getSettings()).exitCacheMinutes, (await local.getSettings()).exitWatchMinutes], [30, 5]);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test('ready-made setups are offered by the API and the MCP tools', async () => {
  const presets = (await api('GET', '/api/presets')).body;
  assert.ok(presets.length >= 5 && presets.every((p: any) => p.id && p.name && p.os && p.description));
  assert.deepEqual(await tool('list_presets'), presets);

  const made = await api('POST', '/api/profiles', { name: 'Laptop', preset: 'windows-laptop', matchProxy: false });
  assert.equal(made.status, 201);
  assert.deepEqual([made.body.os, made.body.screen.width, made.body.deviceMemory, made.body.hardwareConcurrency], ['windows', 1920, 16, 12]);
  assert.match(made.body.webgl.renderer, /Iris\(R\) Xe/);
  assert.equal((await tool('create_profile', { name: 'Phone', preset: 'pixel-8', matchProxy: false })).uaData.model, 'Pixel 8');

  const bulk = await api('POST', '/api/profiles/bulk', { count: 3, name: 'Mac', preset: 'macbook-air', common: { matchProxy: false } });
  assert.equal(bulk.status, 201);
  assert.deepEqual(bulk.body.map((p: any) => p.webgl.renderer), Array(3).fill(bulk.body[0].webgl.renderer));
  assert.equal(new Set(bulk.body.map((p: any) => p.seed)).size, 3);

  const count = (await api('GET', '/api/profiles')).body.length;
  for (const bad of [{ preset: 'toaster' }, { preset: 7 }, { preset: 'pixel-8', os: 'windows' }]) {
    const refused = await api('POST', '/api/profiles', { name: 'No', ...bad });
    assert.equal(refused.status, 400, JSON.stringify(bad));
    assert.equal(typeof refused.body.error, 'string');
  }
  assert.equal((await api('POST', '/api/profiles/bulk', { count: 2, preset: 'toaster' })).status, 400);
  assert.equal((await api('GET', '/api/profiles')).body.length, count, 'a refused request makes nothing');
  // Without one, an identity is generated as before.
  assert.equal((await api('POST', '/api/profiles', { name: 'Plain', os: 'linux', matchProxy: false })).body.os, 'linux');
});

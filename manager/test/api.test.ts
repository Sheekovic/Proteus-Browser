import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import type { Server } from 'node:http';
import { request as httpRequest } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { Launcher } from '../src/launcher.ts';
import { createApiServer } from '../src/server.ts';
import { Store } from '../src/store.ts';

const here = dirname(fileURLToPath(import.meta.url));
const stubKernel = join(here, 'stub-kernel.mjs');

let dir: string;
let store: Store;
let launcher: Launcher;
let server: Server;
let base: string;
let port: number;

before(async () => {
  dir = await mkdtemp(join(tmpdir(), 'proteus-api-'));
  store = new Store(dir);
  // Run the stand-in kernel with Node instead of a real browser binary.
  launcher = new Launcher(store, (_kernelPath, args) =>
    spawn(process.execPath, [stubKernel, ...args], { stdio: 'ignore' }));
  await writeFile(join(dir, 'kernel-placeholder'), '');
  // No lookup service: these tests must not talk to the network.
  await store.updateSettings({ kernelPath: join(dir, 'kernel-placeholder'), exitLookupUrl: '' });

  server = createApiServer({ store, launcher, uiDir: join(here, '..', 'ui') });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = (server.address() as AddressInfo).port;
  base = `http://127.0.0.1:${port}`;
});

after(async () => {
  await launcher.stopAll();
  await new Promise((resolve) => server.close(resolve));
  await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

async function api(method: string, path: string, body?: unknown) {
  const response = await fetch(base + path, {
    method,
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : undefined };
}

/** A raw request, for headers fetch() will not let a caller set (Host, Origin). */
function raw(method: string, path: string, headers: Record<string, string>, body = ''): Promise<number> {
  return new Promise((resolve, reject) => {
    const request = httpRequest({ host: '127.0.0.1', port, method, path, headers }, (response) => {
      response.resume();
      response.on('end', () => resolve(response.statusCode ?? 0));
    });
    request.on('error', reject);
    request.end(body);
  });
}

test('health and the web UI are served', async () => {
  assert.deepEqual((await api('GET', '/api/health')).body, { ok: true, name: 'proteus-manager' });
  const page = await fetch(base + '/');
  assert.equal(page.status, 200);
  assert.match(await page.text(), /Proteus/);
});

test('a profile can be created, started, inspected, stopped and deleted', async () => {
  const created = await api('POST', '/api/profiles', {
    name: 'Automation', os: 'windows', languages: ['en-GB', 'en'], timezone: 'Europe/London',
    unknownField: 'must not be stored',
  });
  assert.equal(created.status, 201);
  const id = created.body.id as string;
  assert.equal(created.body.status.state, 'stopped');
  assert.ok(!('unknownField' in created.body));

  const started = await api('POST', `/api/profiles/${id}/start`);
  assert.equal(started.status, 200);
  assert.equal(started.body.state, 'running');
  assert.equal(started.body.debuggerUrl, 'http://127.0.0.1:45678');
  assert.ok(started.body.pid > 0);

  // The kernel was started with this profile's own data directory and config file ...
  const profileDir = join(dir, 'profiles', id);
  const kernelArgs: string[] = JSON.parse(await readFile(join(profileDir, 'browser', 'stub-args.json'), 'utf8'));
  assert.ok(kernelArgs.includes(`--user-data-dir=${join(profileDir, 'browser')}`));
  assert.ok(kernelArgs.includes(`--proteus-config=${join(profileDir, 'kernel.json')}`));
  assert.ok(kernelArgs.includes('--lang=en-GB'));

  // ... and that config file describes the profile.
  const config = JSON.parse(await readFile(join(profileDir, 'kernel.json'), 'utf8'));
  assert.equal(config.seed, created.body.seed);
  assert.equal(config.platform, 'Win32');
  assert.equal(config.timezone, 'Europe/London');
  assert.deepEqual(config.languages, ['en-GB', 'en']);

  // Starting twice does not launch a second browser.
  assert.equal((await api('POST', `/api/profiles/${id}/start`)).body.pid, started.body.pid);
  assert.equal((await api('GET', `/api/profiles/${id}`)).body.status.state, 'running');

  // A running profile cannot be deleted or given a new identity.
  assert.equal((await api('DELETE', `/api/profiles/${id}`)).status, 409);
  assert.equal((await api('POST', `/api/profiles/${id}/regenerate`)).status, 409);

  const stopped = await api('POST', `/api/profiles/${id}/stop`);
  assert.equal(stopped.body.state, 'stopped');
  assert.equal((await api('GET', `/api/profiles/${id}/status`)).body.state, 'stopped');

  const regenerated = await api('POST', `/api/profiles/${id}/regenerate`);
  assert.notEqual(regenerated.body.seed, created.body.seed);
  assert.equal(regenerated.body.name, 'Automation');
  assert.equal(regenerated.body.timezone, 'Europe/London');

  assert.equal((await api('DELETE', `/api/profiles/${id}`)).status, 204);
  assert.equal((await api('GET', `/api/profiles/${id}`)).status, 404);
});

test('a kernel that exits immediately is reported as a failed start', async () => {
  await store.updateSettings({ extraArgs: ['--stub-exit-now'] });
  try {
    const { body } = await api('POST', '/api/profiles', { name: 'Crashes' });
    const started = await api('POST', `/api/profiles/${body.id}/start`);
    assert.equal(started.status, 502);
    assert.match(started.body.error, /exited right after starting \(exit code 7\)/);
    assert.equal((await api('GET', `/api/profiles/${body.id}/status`)).body.state, 'stopped');
  } finally {
    await store.updateSettings({ extraArgs: [] });
  }
});

test('starting without a configured kernel gives a clear error', async () => {
  const original = (await store.getSettings()).kernelPath;
  const { body } = await api('POST', '/api/profiles', { name: 'No kernel' });
  try {
    await store.updateSettings({ kernelPath: '' });
    let started = await api('POST', `/api/profiles/${body.id}/start`);
    assert.equal(started.status, 502);
    assert.match(started.body.error, /No kernel is configured/);

    await store.updateSettings({ kernelPath: join(dir, 'does-not-exist') });
    started = await api('POST', `/api/profiles/${body.id}/start`);
    assert.equal(started.status, 502);
    assert.match(started.body.error, /Kernel not found/);
  } finally {
    await store.updateSettings({ kernelPath: original });
  }
});

test('bad input and unknown routes get proper errors', async () => {
  assert.equal((await api('POST', '/api/profiles', { timezone: 'Nowhere/Land' })).status, 400);
  assert.equal((await api('GET', '/api/profiles/not-a-uuid')).status, 404);
  assert.equal((await api('GET', '/api/profiles/..%2F..%2Fsettings.json')).status, 404);
  assert.equal((await api('GET', '/api/nope')).status, 404);
  assert.equal((await api('PUT', '/api/profiles')).status, 404);
});

test('other websites cannot drive the API', async () => {
  const json = { 'Content-Type': 'application/json' };
  const host = `127.0.0.1:${port}`;
  const before = (await store.listProfiles()).length;

  // A page on another site calling the API directly.
  assert.equal(await raw('POST', '/api/profiles', { ...json, Host: host, Origin: 'https://evil.example' }, '{}'), 403);
  // DNS rebinding: an attacker's name pointed at 127.0.0.1.
  assert.equal(await raw('GET', '/api/profiles', { Host: 'evil.example' }), 403);
  // A plain HTML form post, which browsers send without a CORS preflight.
  assert.equal(await raw('POST', '/api/profiles', { Host: host, 'Content-Type': 'text/plain' }, '{}'), 415);
  // The manager's own page is allowed.
  assert.equal(await raw('GET', '/api/profiles', { Host: host, Origin: `http://${host}` }), 200);

  assert.equal((await store.listProfiles()).length, before, 'no blocked request created a profile');
});

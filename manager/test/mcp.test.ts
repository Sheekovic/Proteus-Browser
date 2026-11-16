import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import type { Server } from 'node:http';
import { request as httpRequest } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { BrowserError, cleanCookies } from '../src/browserControl.ts';
import { Launcher } from '../src/launcher.ts';
import { createApiServer } from '../src/server.ts';
import { Store } from '../src/store.ts';

const here = dirname(fileURLToPath(import.meta.url));
let dir: string;
let launcher: Launcher;
let server: Server;
let base: string;
let port: number;

before(async () => {
  dir = await mkdtemp(join(tmpdir(), 'proteus-mcp-'));
  const store = new Store(dir);
  // The stand-in kernel, and no touching of file permissions for it.
  launcher = new Launcher(store, (_kernelPath, args) =>
    spawn(process.execPath, [join(here, 'stub-kernel.mjs'), ...args], { stdio: 'ignore' }), async () => true);
  await writeFile(join(dir, 'kernel-placeholder'), '');
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

/** One MCP request; returns the JSON-RPC reply, or the HTTP status when there is none. */
async function mcp(method: string, params?: unknown, notification = false) {
  const response = await fetch(base + '/mcp', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', ...(notification ? {} : { id: 1 }), method, ...(params === undefined ? {} : { params }) }),
  });
  const text = await response.text();
  return text ? JSON.parse(text) : { status: response.status };
}

/** Calls an MCP tool and returns what it answered, parsed when it is JSON. */
async function tool(name: string, args: Record<string, unknown> = {}) {
  const reply = await mcp('tools/call', { name, arguments: args });
  const first = reply.result.content[0];
  let value: any = first.text;
  try { value = JSON.parse(first.text); } catch { /* a plain message */ }
  return { value, isError: reply.result.isError === true };
}

async function get(path: string) {
  const response = await fetch(base + path);
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : undefined };
}

test('the MCP endpoint speaks the protocol', async () => {
  const hello = await mcp('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
  assert.equal(hello.jsonrpc, '2.0');
  assert.equal(hello.id, 1);
  assert.equal(hello.result.protocolVersion, '2025-03-26', 'the version the client asked for, when it is one we speak');
  assert.equal(hello.result.serverInfo.name, 'proteus');
  assert.ok(hello.result.capabilities.tools);
  assert.equal((await mcp('initialize', { protocolVersion: '1999-01-01' })).result.protocolVersion, '2025-06-18');

  assert.deepEqual(await mcp('notifications/initialized', undefined, true), { status: 202 }, 'a notification gets no reply');
  assert.deepEqual((await mcp('ping')).result, {});
  assert.equal((await mcp('no/such/method')).error.code, -32601);

  const { tools } = (await mcp('tools/list')).result;
  const names = tools.map((t: { name: string }) => t.name);
  for (const needed of ['list_profiles', 'create_profile', 'update_profile', 'delete_profile', 'start_profile', 'stop_profile',
                        'new_identity', 'list_devices', 'get_settings', 'update_settings', 'list_tabs', 'open_tab', 'navigate',
                        'page_text', 'evaluate', 'screenshot', 'get_cookies', 'set_cookies']) {
    assert.ok(names.includes(needed), needed);
  }
  for (const t of tools) {
    assert.ok(t.description.length > 20, `${t.name} says what it does`);
    assert.equal(t.inputSchema.type, 'object');
  }
});

test('the endpoint and the route list are for local callers only', async () => {
  const listing = await get('/api');
  assert.ok(listing.body.routes.includes('POST /mcp') && listing.body.routes.includes('GET /api/profiles/:id/tabs'));
  assert.equal((await fetch(base + '/mcp')).status, 405);
  const status = await new Promise<number>((resolve, reject) => {
    const request = httpRequest({ host: '127.0.0.1', port, method: 'POST', path: '/mcp',
      headers: { Host: `127.0.0.1:${port}`, Origin: 'https://evil.example', 'Content-Type': 'application/json' } }, (response) => {
      response.resume();
      response.on('end', () => resolve(response.statusCode ?? 0));
    });
    request.on('error', reject);
    request.end(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }));
  });
  assert.equal(status, 403, 'a page of another site cannot reach it');
});

test('profiles are managed through MCP tools', async () => {
  const created = await tool('create_profile', { name: 'Made by an assistant', os: 'android', timezone: 'Europe/Berlin' });
  assert.equal(created.isError, false);
  assert.equal(created.value.os, 'android');
  assert.equal(created.value.status.state, 'stopped');
  const id = created.value.id;

  const entry = (await tool('list_profiles')).value.find((p: { id: string }) => p.id === id);
  assert.deepEqual([entry.name, entry.state, entry.timezone], ['Made by an assistant', 'stopped', 'Europe/Berlin']);

  assert.equal((await tool('update_profile', { id, name: 'Renamed', startUrl: 'https://example.com/' })).value.name, 'Renamed');
  assert.equal((await tool('get_profile', { id })).value.startUrl, 'https://example.com/');

  // Mistakes come back as tool errors the assistant can read, not as protocol failures.
  const bad = await tool('update_profile', { id, timezone: 'Mars/Olympus' });
  assert.equal(bad.isError, true);
  assert.match(bad.value, /time zone/);
  assert.equal((await tool('get_profile', {})).isError, true, 'a missing argument');
  assert.equal((await tool('get_profile', { id: '00000000-0000-4000-8000-000000000000' })).isError, true);
  assert.equal((await tool('no_such_tool')).isError, true);
  const tabs = await tool('list_tabs', { id });
  assert.equal(tabs.isError, true);
  assert.match(tabs.value, /not running/);

  assert.equal((await tool('start_profile', { id })).value.state, 'running');
  assert.equal((await tool('delete_profile', { id })).isError, true, 'a running profile is not deleted');
  assert.equal((await tool('new_identity', { id })).isError, true);
  assert.equal((await tool('stop_profile', { id })).value.state, 'stopped');

  const before = (await tool('get_profile', { id })).value.seed;
  assert.notEqual((await tool('new_identity', { id })).value.seed, before);
  assert.deepEqual((await tool('delete_profile', { id })).value, { deleted: id });
  assert.ok(!(await tool('list_profiles')).value.some((p: { id: string }) => p.id === id));

  assert.ok('kernelPath' in (await tool('get_settings')).value);
  assert.deepEqual((await tool('list_devices')).value, []);
});

test('browser control needs a running profile', async () => {
  const profile = (await tool('create_profile', { name: 'Stopped' })).value;
  assert.equal((await get(`/api/profiles/${profile.id}/tabs`)).status, 409);
  assert.equal((await get(`/api/profiles/${profile.id}/cookies`)).status, 409);
  assert.equal((await get('/api/profiles/00000000-0000-4000-8000-000000000000/tabs')).status, 404);
  await tool('delete_profile', { id: profile.id });
});

test('cookies from a caller are checked and reduced to what the browser takes', () => {
  const cleaned = cleanCookies([
    { name: 'sid', value: 'abc', domain: '.example.com', path: '/', expires: 1900000000, httpOnly: true, secure: true, sameSite: 'Lax', extra: 'dropped' },
    { name: 'plain', value: '', domain: 'example.org' },
  ]);
  assert.deepEqual(cleaned, [
    { name: 'sid', value: 'abc', domain: '.example.com', path: '/', expires: 1900000000, httpOnly: true, secure: true, sameSite: 'Lax' },
    { name: 'plain', value: '', domain: 'example.org', path: '/' },
  ]);
  for (const bad of ['cookies', [{ name: 'x' }], [{ name: '', value: 'v', domain: 'd' }], [{ name: 'n', value: 5, domain: 'd' }], [null]]) {
    assert.throws(() => cleanCookies(bad), BrowserError, JSON.stringify(bad));
  }
  assert.deepEqual(cleanCookies([]), []);
});

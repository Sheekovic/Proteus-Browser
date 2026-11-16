// Managing many profiles: proxy lists, making several at once, duplicating, tags,
// and the cookie files people bring from other browsers.

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';

import { BrowserError, cookiesFromText } from '../src/browserControl.ts';
import { createProfiles } from '../src/bulk.ts';
import { ValidationError } from '../src/profile.ts';
import { checkProxy } from '../src/proxyExit.ts';
import { parseProxyLine, parseProxyList } from '../src/proxyList.ts';
import { Store } from '../src/store.ts';

const dataDir = mkdtempSync(join(tmpdir(), 'proteus-manage-'));
const store = new Store(dataDir);
after(() => rmSync(dataDir, { recursive: true, force: true }));

test('proxies are read in the spellings providers use', () => {
  assert.deepEqual(parseProxyLine('10.0.0.1:8080'), { type: 'http', host: '10.0.0.1', port: 8080 });
  assert.deepEqual(parseProxyLine('res.example.com:10000:alice:s3cret'),
                   { type: 'http', host: 'res.example.com', port: 10000, username: 'alice', password: 's3cret' });
  assert.deepEqual(parseProxyLine('res.example.com;10000;alice;s3cret'),
                   { type: 'http', host: 'res.example.com', port: 10000, username: 'alice', password: 's3cret' });
  assert.deepEqual(parseProxyLine('alice:p@ss:word@res.example.com:1080', 'socks5'),
                   { type: 'socks5', host: 'res.example.com', port: 1080, username: 'alice', password: 'p@ss:word' });
  assert.deepEqual(parseProxyLine('socks5://res.example.com:1080'), { type: 'socks5', host: 'res.example.com', port: 1080 });
  assert.deepEqual(parseProxyLine('http://alice:pw@res.example.com:3128/'),
                   { type: 'http', host: 'res.example.com', port: 3128, username: 'alice', password: 'pw' });
  // A password may hold the separator.
  assert.equal(parseProxyLine('h.example:1:u:a:b:c').password, 'a:b:c');
  for (const bad of ['just-a-host', 'host:notaport', 'ftp://host:21', 'host:99999', ':8080']) {
    assert.throws(() => parseProxyLine(bad), ValidationError, bad);
  }
  // The message names the line without repeating its password.
  assert.throws(() => parseProxyLine('res.example.com:70000:alice:verysecretpassword'),
                (error: Error) => !error.message.includes('verysecretpassword'));
});

test('a pasted list skips blank lines and comments', () => {
  const list = parseProxyList('\n# my proxies\n10.0.0.1:8080\r\n\r\n  10.0.0.2:8080:u:p  \n', 'socks5');
  assert.deepEqual(list.map((p) => `${p.type} ${p.host}:${p.port} ${p.username ?? '-'}`),
                   ['socks5 10.0.0.1:8080 -', 'socks5 10.0.0.2:8080 u']);
  assert.deepEqual(parseProxyList(''), []);
});

test('several profiles are made at once, each a device of its own with a proxy of its own', async () => {
  const made = await createProfiles(store, {
    count: 3, name: 'Shop', common: { os: 'windows', tags: ['shop'], timezone: 'Europe/Berlin', name: 'ignored', seed: '1' },
    proxies: '10.0.0.1:8080:u:p\n10.0.0.2:8080:u:p\n10.0.0.3:8080:u:p',
  });
  assert.deepEqual(made.map((p) => p.name), ['Shop 1', 'Shop 2', 'Shop 3']);
  assert.deepEqual(made.map((p) => p.proxy?.host), ['10.0.0.1', '10.0.0.2', '10.0.0.3']);
  assert.equal(new Set(made.map((p) => p.seed)).size, 3, 'three different devices');
  assert.ok(made.every((p) => p.tags[0] === 'shop' && p.timezone === 'Europe/Berlin' && p.os === 'windows'));
  assert.equal((await store.listProfiles()).length, 3);

  // Fewer proxies than profiles links accounts by their address: refused unless asked for.
  await assert.rejects(createProfiles(store, { count: 3, proxies: '10.0.0.1:8080' }), /need 3 proxies/);
  const shared = await createProfiles(store, { count: 3, name: 'Shared', proxies: '10.0.0.1:8080\n10.0.0.2:8080', shareProxies: true });
  assert.deepEqual(shared.map((p) => p.proxy?.host), ['10.0.0.1', '10.0.0.2', '10.0.0.1']);
  const plain = await createProfiles(store, { count: 2, name: 'Plain' });
  assert.ok(plain.every((p) => p.proxy === null));
});

test('a bad request makes no profiles at all', async () => {
  const before = (await store.listProfiles()).length;
  await assert.rejects(createProfiles(store, { count: 0 }), ValidationError);
  await assert.rejects(createProfiles(store, { count: 201 }), ValidationError);
  await assert.rejects(createProfiles(store, { count: 2, proxies: '10.0.0.1:8080\nnot a proxy' }), ValidationError);
  await assert.rejects(createProfiles(store, { count: 2, common: { timezone: 'Mars/Olympus' } }), ValidationError);
  await assert.rejects(createProfiles(store, { count: 2, proxies: 5 as never }), ValidationError);
  await assert.rejects(createProfiles(store, { count: 2, fingerprintId: '00000000-0000-4000-8000-000000000000' }));
  assert.equal((await store.listProfiles()).length, before);
});

test('a duplicate has the same settings and is another device', async () => {
  const source = await store.createProfile({
    name: 'Original', tags: ['client A'], languages: ['de-DE'], timezone: 'Europe/Berlin', startUrl: 'https://example.com/',
    proxy: { type: 'socks5', host: '10.0.0.9', port: 1080, username: 'u', password: 'p' },
  });
  const copy = await store.duplicateProfile(source.id);
  assert.equal(copy.name, 'Original copy');
  assert.notEqual(copy.id, source.id);
  assert.notEqual(copy.seed, source.seed, 'a device identity of its own');
  assert.deepEqual([copy.tags, copy.languages, copy.timezone, copy.startUrl, copy.proxy, copy.os],
                   [source.tags, source.languages, source.timezone, source.startUrl, source.proxy, source.os]);
  copy.proxy!.host = 'changed';
  assert.equal((await store.getProfile(source.id)).proxy!.host, '10.0.0.9', 'the copy does not share the original\'s objects');
});

test('tags are short labels', async () => {
  assert.deepEqual((await store.createProfile({ tags: ['a', 'client B'] })).tags, ['a', 'client B']);
  assert.deepEqual((await store.createProfile({})).tags, []);
  for (const tags of [['a,b'], [''], ['x'.repeat(41)], Array.from({ length: 21 }, (_, i) => `t${i}`), 'shop', [5]]) {
    await assert.rejects(store.createProfile({ tags: tags as never }), ValidationError, JSON.stringify(tags));
  }
});

test('cookie files from other browsers are understood', () => {
  // As browser extensions export them.
  const fromExtension = cookiesFromText(JSON.stringify([
    { domain: '.example.com', name: 'sid', value: 'abc', path: '/', expirationDate: 1900000000.5, hostOnly: false,
      httpOnly: true, secure: true, sameSite: 'no_restriction', storeId: '0' },
    { domain: 'example.org', name: 'theme', value: 'dark', sameSite: 'lax', session: true },
  ]));
  assert.deepEqual(fromExtension, [
    { name: 'sid', value: 'abc', domain: '.example.com', path: '/', expires: 1900000000.5, httpOnly: true, secure: true, sameSite: 'None' },
    { name: 'theme', value: 'dark', domain: 'example.org', path: '/', sameSite: 'Lax' },
  ]);
  assert.equal(cookiesFromText('{"cookies":[{"name":"a","value":"b","domain":"c.example"}]}').length, 1);

  // The cookies.txt form.
  const netscape = ['# Netscape HTTP Cookie File', '', '.example.com\tTRUE\t/\tTRUE\t1900000000\tsid\tabc',
                    '#HttpOnly_example.org\tFALSE\t/app\tFALSE\t0\ttoken\tx\ty'].join('\n');
  assert.deepEqual(cookiesFromText(netscape), [
    { name: 'sid', value: 'abc', domain: '.example.com', path: '/', expires: 1900000000, secure: true },
    { name: 'token', value: 'x\ty', domain: 'example.org', path: '/app', httpOnly: true },
  ]);

  for (const bad of ['', 'hello', '[{"name":"x"}]', '{"cookies":"no"}', '[broken', 5]) {
    assert.throws(() => cookiesFromText(bad), BrowserError, String(bad));
  }
});

test('checking a proxy needs the exit lookup', async () => {
  await assert.rejects(checkProxy({ type: 'http', host: '127.0.0.1', port: 9 }, ''), /turned off/);
});

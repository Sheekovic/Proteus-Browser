// How a browser introduces itself to a server (TLS hello, HTTP/2 opening): reading it,
// keeping it in step with what a profile claims, and the report that shows both.

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { connect as connectHttp2 } from 'node:http2';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, before, test } from 'node:test';
import { connect as connectTls } from 'node:tls';
import { fileURLToPath } from 'node:url';

import { generateIdentity } from '../src/fingerprint.ts';
import { buildKernelArgs } from '../src/kernelConfig.ts';
import { Launcher } from '../src/launcher.ts';
import { listPresets } from '../src/presets.ts';
import type { Profile } from '../src/profile.ts';
import { createApiServer } from '../src/server.ts';
import { Store } from '../src/store.ts';
import {
  http2Fingerprint, parseClientHello, parseHttp2Opening, startRecorder, type TransportShape,
} from '../src/transport.ts';
import { claimOf, referenceFor, reportTransport, shapeSwitches } from '../src/transportClaim.ts';

const here = dirname(fileURLToPath(import.meta.url));
const KERNEL = '158.0.8127.37';

// What stock Chrome 157 sent to the recorder (and the kernel, once the padding
// experiment is off). An outside fingerprinting service gave the same two strings
// for these two hellos, which is what ties this parser to the published format.
const CIPHERS = [0x1301, 0x1302, 0x1303, 0xc02b, 0xc02f, 0xc02c, 0xc030, 0xcca9, 0xcca8, 0xc013, 0xc014, 0x009c, 0x009d, 0x002f, 0x0035];
const EXTENSIONS = [0x0000, 0x0005, 0x000a, 0x000b, 0x000d, 0x0010, 0x0012, 0x0017, 0x001b, 0x0023, 0x002b, 0x002d, 0x0033,
                    0x44cd, 0xca34, 0xfe0d, 0xff01];
const SIGNATURES = [0x0904, 0x0905, 0x0906, 0x0403, 0x0804, 0x0401, 0x0503, 0x0805, 0x0501, 0x0806, 0x0601];
const STOCK_JA4 = 't13d1517h2_8daaf6152771_cb7bf5808d99';
const PADDED_JA4 = 't13d1518h2_8daaf6152771_4980c97edce0';
const CHROME_HTTP2 = '1:65536;2:0;4:6291456;6:262144|15663105|0|m,a,s,p';

const u8 = (n: number) => Buffer.from([n]);
const u16 = (n: number) => Buffer.from([n >> 8, n & 0xff]);
const sized = (prefix: 1 | 2, ...parts: Buffer[]) => {
  const body = Buffer.concat(parts);
  return Buffer.concat([prefix === 1 ? u8(body.length) : u16(body.length), body]);
};

/** A ClientHello as Chrome lays one out: GREASE mixed in, extensions in the order given. */
function clientHello(extensions: number[], recordSize = 16000): Buffer {
  const body = (type: number): Buffer => {
    if (type === 0) return sized(2, u8(0), sized(2, Buffer.from('localhost')));
    if (type === 10) return sized(2, u16(0x3a3a), u16(0x11ec), u16(0x001d), u16(0x0017), u16(0x0018));
    if (type === 13) return sized(2, u16(0x7a7a), ...SIGNATURES.map(u16));
    if (type === 16) return sized(2, sized(1, Buffer.from('h2')), sized(1, Buffer.from('http/1.1')));
    if (type === 43) return sized(1, u16(0xdada), u16(0x0304), u16(0x0303));
    if (type === 51) return sized(2, u16(0x3a3a), sized(2, u8(0)), u16(0x11ec), sized(2, Buffer.alloc(1216)), u16(0x001d), sized(2, Buffer.alloc(32)));
    return Buffer.alloc(type === 0xfe0d ? 180 : 1);
  };
  const all = [0x4a4a, ...extensions, 0x1a1a];
  const hello = Buffer.concat([
    u16(0x0303), Buffer.alloc(32, 7), sized(1, Buffer.alloc(32, 9)),
    sized(2, u16(0xbaba), ...CIPHERS.map(u16)), sized(1, u8(0)),
    sized(2, ...all.map((type) => Buffer.concat([u16(type), sized(2, body(type))]))),
  ]);
  const message = Buffer.concat([u8(1), u8(0), u16(hello.length), hello]);
  const records: Buffer[] = [];
  for (let at = 0; at < message.length; at += recordSize) {
    const part = message.subarray(at, at + recordSize);
    records.push(u8(22), u16(0x0301), u16(part.length), part);
  }
  return Buffer.concat(records);
}

test('a TLS hello is read into the JA4 fingerprint an outside service gives for it', () => {
  // Chrome sends its extensions in a new order every time; the fingerprint must not care.
  const shuffled = [...EXTENSIONS].reverse();
  const stock = parseClientHello(clientHello(shuffled));
  assert.ok(stock);
  assert.equal(stock.ja4, STOCK_JA4);
  assert.equal(parseClientHello(clientHello(EXTENSIONS))?.ja4, STOCK_JA4, 'whatever the order');
  assert.equal(stock.version, '1.3');
  assert.deepEqual(stock.alpn, ['h2', 'http/1.1']);
  assert.deepEqual(stock.groups, ['11ec', '001d', '0017', '0018'], 'GREASE left out');
  assert.deepEqual(stock.keyShares, ['11ec', '001d']);
  assert.equal(stock.ciphers.length, 15);
  assert.ok(stock.grease && stock.serverName && !stock.resumption);

  // The experiment's extension makes it the other fingerprint the service reported.
  const padded = parseClientHello(clientHello([...EXTENSIONS, 0x12e0]));
  assert.equal(padded?.ja4, PADDED_JA4);
  assert.ok(padded?.extensions.includes('12e0'));

  // Offering to resume a session adds an extension, and is said.
  assert.equal(parseClientHello(clientHello([...EXTENSIONS, 0x0029]))?.resumption, true);
});

test('a hello that arrives in pieces is waited for, and other bytes are refused', () => {
  const whole = clientHello(EXTENSIONS);
  for (const cut of [0, 3, 5, 9, 200, whole.length - 1]) {
    assert.equal(parseClientHello(whole.subarray(0, cut)), null, `${cut} bytes are not all of it`);
  }
  assert.equal(parseClientHello(Buffer.concat([whole, Buffer.from('later bytes')]))?.ja4, STOCK_JA4);
  assert.equal(parseClientHello(clientHello(EXTENSIONS, 500))?.ja4, STOCK_JA4, 'split over several records');
  assert.throws(() => parseClientHello(Buffer.from('GET / HTTP/1.1\r\n\r\n')), /TLS handshake/);
});

test('the opening of an HTTP/2 connection is read into its fingerprint', () => {
  const frame = (type: number, flags: number, stream: number, body: Buffer) =>
    Buffer.concat([Buffer.from([0, body.length >> 8, body.length & 0xff, type, flags, 0, 0, 0, stream]), body]);
  const setting = (id: number, value: number) => { const b = Buffer.alloc(6); b.writeUInt16BE(id); b.writeUInt32BE(value, 2); return b; };
  const u32 = (n: number) => { const b = Buffer.alloc(4); b.writeUInt32BE(n); return b; };
  const preface = Buffer.from('PRI * HTTP/2.0\r\n\r\nSM\r\n\r\n');
  // Chrome: four settings, a window update, then a request whose HEADERS carry a priority.
  const chrome = Buffer.concat([
    preface,
    frame(4, 0, 0, Buffer.concat([setting(1, 65536), setting(2, 0), setting(4, 6291456), setting(6, 262144)])),
    frame(8, 0, 0, u32(15663105)),
    frame(1, 0x25, 1, Buffer.concat([u32(0x80000000), u8(255), Buffer.from('headers')])),
    frame(4, 0, 0, setting(1, 1)),
  ]);
  const opening = parseHttp2Opening(chrome);
  assert.ok(opening.complete);
  assert.deepEqual(opening.settings, [[1, 65536], [2, 0], [4, 6291456], [6, 262144]], 'the first SETTINGS frame only');
  assert.deepEqual(opening.headersPriority, { weight: 256, dependsOn: 0, exclusive: true });
  assert.equal(http2Fingerprint(opening, [':method', ':authority', ':scheme', ':path']), CHROME_HTTP2);

  // A client that sends PRIORITY frames and no window update, with another header order.
  const other = parseHttp2Opening(Buffer.concat([
    preface, frame(4, 0, 0, setting(3, 100)), frame(2, 0, 3, Buffer.concat([u32(0), u8(200)])), frame(1, 0x4, 5, Buffer.alloc(3)),
  ]));
  assert.equal(http2Fingerprint(other, [':method', ':scheme', ':path', ':authority']), '3:100|00|3:0:0:201|m,s,p,a');
  assert.equal(other.headersPriority, null);

  assert.equal(parseHttp2Opening(chrome.subarray(0, 40)).complete, false, 'not yet at the request');
  assert.equal(parseHttp2Opening(Buffer.from('GET / HTTP/1.1\r\n\r\n')).settings.length, 0);
});

test('the recorder reports the client that connects to it, and nothing leaves the machine', async () => {
  const recorder = await startRecorder(10_000);
  try {
    assert.match(recorder.url, /^https:\/\/localhost:\d+\/$/);
    const session = connectHttp2(recorder.url, { rejectUnauthorized: false, settings: { initialWindowSize: 123456, enablePush: false } });
    const request = session.request({ ':path': '/', 'user-agent': 'a test', 'x-second': '1' });
    let body = '';
    request.setEncoding('utf8').on('data', (chunk) => { body += chunk; });
    await new Promise((resolve) => request.on('end', resolve));
    session.close();
    const shape = await recorder.shape;
    assert.equal(body, 'recorded\n');
    // Node's own shape, whatever it is in this version: a real hello, really parsed.
    assert.match(shape.tls.ja4, /^t1[23]d\d{4}h2_[0-9a-f]{12}_[0-9a-f]{12}$/);
    assert.deepEqual(shape.tls.alpn, ['h2']);
    assert.ok(shape.tls.ciphers.length > 0 && shape.tls.extensions.includes('0010'));
    assert.ok(shape.http2);
    assert.ok(shape.http2.settings.some(([id, value]) => id === 4 && value === 123456), 'the settings it sent');
    assert.ok(shape.http2.fingerprint.includes('4:123456'));
    assert.equal(shape.http2.pseudoHeaders.length, 4);
    assert.deepEqual(shape.http2.headers, ['user-agent', 'x-second'], 'the other headers, in the order sent');
    assert.equal(shape.http2.fingerprint.split('|').length, 4);
    assert.equal(shape.userAgent, 'a test');
  } finally {
    await recorder.close();
  }
});

test('a client that stops after its hello is reported by the hello alone', async () => {
  const recorder = await startRecorder(10_000, 300);
  try {
    // Refuses the recorder's certificate, as a browser left to itself would.
    const socket = connectTls({ host: '127.0.0.1', port: Number(new URL(recorder.url).port), servername: 'localhost', ALPNProtocols: ['h2'] });
    socket.on('error', () => {});
    const shape = await recorder.shape;
    assert.equal(shape.http2, null);
    assert.ok(shape.tls.serverName);
    socket.destroy();
  } finally {
    await recorder.close();
  }
  const nobody = await startRecorder(50);
  await assert.rejects(nobody.shape, /no browser connected/);
  await nobody.close();
});

const shapeOf = (ja4: string, extensions: number[], http2: string | null, userAgent: string): TransportShape => ({
  tls: { ...parseClientHello(clientHello(extensions))!, ja4 },
  http2: http2 === null ? null : {
    fingerprint: http2, settings: [], windowUpdate: 0, headersPriority: null, priorityFrames: [],
    pseudoHeaders: [':method', ':authority', ':scheme', ':path'], headers: [],
  },
  userAgent,
});

test('what a profile claims to be is read from it, for every system and ready-made setup', async () => {
  for (const os of ['windows', 'macos', 'linux', 'android'] as const) {
    const claim = claimOf(generateIdentity(os, KERNEL));
    assert.deepEqual([claim.browser, claim.version, claim.major], ['Chrome', KERNEL, 158], os);
    assert.ok(referenceFor(claim), `${os}: a measured shape to hold it to`);
  }
  const iphone = claimOf(generateIdentity('ios', KERNEL));
  assert.equal(iphone.browser, 'Safari');
  assert.match(iphone.version, /^\d+\.\d+/);
  assert.equal(referenceFor(iphone), null);
  assert.equal(claimOf({ userAgent: 'curl/8', uaData: generateIdentity('windows', KERNEL).uaData }).browser, 'unknown');
  // A version the client hints do not back up is taken from the User-Agent.
  const older = { ...generateIdentity('windows', KERNEL) };
  older.userAgent = older.userAgent.replace('Chrome/158', 'Chrome/150');
  assert.deepEqual([claimOf(older).major, claimOf(older).version], [150, '150.0.0.0']);

  // Each ready-made setup names the version its handshake is that of, except the iPhone.
  const dir = await mkdtemp(join(tmpdir(), 'proteus-claims-'));
  try {
    const store = new Store(dir);
    for (const preset of listPresets()) {
      const claim = claimOf(await store.createProfile({ name: preset.id, matchProxy: false }, undefined, preset.id));
      if (preset.id === 'iphone-15') assert.equal(claim.browser, 'Safari');
      else assert.deepEqual([claim.browser, claim.version], ['Chrome', KERNEL], preset.id);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('a profile is started without the experiment that changes its handshake', () => {
  const profile = {
    ...generateIdentity('windows', KERNEL), id: 'x', name: 'n', notes: '', createdAt: '', updatedAt: '',
    languages: [], timezone: '', webrtc: 'proxyOnly', webrtcPublicIp: '', geolocation: null, proxy: null,
    matchProxy: false, startUrl: '',
  } as unknown as Profile;
  assert.deepEqual(shapeSwitches(claimOf(profile)), ['AddTLSServerHandshakePadding']);
  for (const networkSandbox of [true, false]) {
    const features = buildKernelArgs(profile, { userDataDir: 'u', configFile: 'c', networkSandbox }, [])
        .filter((a) => a.startsWith('--disable-features='));
    assert.equal(features.length, 1, 'one list: a second switch would replace the first');
    assert.ok(features[0].split('=')[1].split(',').includes('AddTLSServerHandshakePadding'));
    assert.ok(features[0].includes('OptimizationHints'), 'beside the ones that were there');
  }
});

test('the report says whether the handshake agrees with the claim, and why not', () => {
  const windows = generateIdentity('windows', KERNEL);
  const agreed = reportTransport(windows, KERNEL, shapeOf(STOCK_JA4, EXTENSIONS, CHROME_HTTP2, windows.userAgent));
  assert.equal(agreed.agrees, true);
  assert.deepEqual(agreed.differences, []);
  assert.deepEqual(agreed.claims, { browser: 'Chrome', version: KERNEL, userAgent: windows.userAgent });
  assert.deepEqual(agreed.kernel, { version: KERNEL });
  assert.deepEqual(agreed.expected, { ja4: STOCK_JA4, http2: CHROME_HTTP2, measuredFrom: 'Chrome 157.0.8103.79, Windows 11' });
  assert.ok(agreed.notes.some((note) => /stock Chrome 158 has not been measured/.test(note)), 'what the expectation rests on is said');

  // The handshake this was written to fix: one extension too many.
  const padded = reportTransport(windows, KERNEL, shapeOf(PADDED_JA4, [...EXTENSIONS, 0x12e0], CHROME_HTTP2, windows.userAgent));
  assert.equal(padded.agrees, false);
  assert.match(padded.differences.join(' '), /extra TLS extensions 0x12e0/);
  assert.match(padded.differences.join(' '), new RegExp(PADDED_JA4));

  const missing = reportTransport(windows, KERNEL, shapeOf('t13d1516h2_8daaf6152771_806a8c22fdea',
      EXTENSIONS.filter((e) => e !== 0xca34), '1:65536|00|0|m,s,a,p', windows.userAgent));
  assert.match(missing.differences.join(' '), /missing TLS extensions 0xca34/);
  assert.match(missing.differences.join(' '), /HTTP\/2: produced 1:65536\|00\|0\|m,s,a,p/);

  // A claim the kernel cannot back: another Chrome version, or Safari.
  const older = { ...windows, userAgent: windows.userAgent.replace('Chrome/158', 'Chrome/150') };
  const stale = reportTransport(older, KERNEL, shapeOf(STOCK_JA4, EXTENSIONS, CHROME_HTTP2, older.userAgent));
  assert.equal(stale.agrees, false);
  assert.match(stale.differences[0], /claims Chrome 150, but the kernel is Chromium 158/);
  assert.equal(stale.expected, null, 'no shape was measured for that version');

  const iphone = generateIdentity('ios', KERNEL);
  const safari = reportTransport(iphone, KERNEL, shapeOf(STOCK_JA4, EXTENSIONS, CHROME_HTTP2, iphone.userAgent));
  assert.equal(safari.agrees, false);
  assert.match(safari.differences[0], /claims Safari/);
  assert.equal(safari.claims.browser, 'Safari');

  // A kernel of a newer version than the profile was made for.
  assert.equal(reportTransport(windows, '160.0.1.2', shapeOf(STOCK_JA4, EXTENSIONS, CHROME_HTTP2, windows.userAgent)).agrees, false);

  // Other things that do not agree, or are worth saying.
  const hello = reportTransport(windows, KERNEL, shapeOf(STOCK_JA4, EXTENSIONS, null, windows.userAgent));
  assert.match(hello.differences.join(' '), /only the hello was recorded/);
  const agent = reportTransport(windows, KERNEL, shapeOf(STOCK_JA4, EXTENSIONS, CHROME_HTTP2, 'HeadlessChrome'));
  assert.match(agent.differences.join(' '), /carried the User-Agent "HeadlessChrome"/);
  const phone = generateIdentity('android', KERNEL);
  const android = reportTransport(phone, KERNEL, shapeOf(STOCK_JA4, EXTENSIONS, CHROME_HTTP2, phone.userAgent));
  assert.ok(android.agrees);
  assert.ok(android.notes.some((note) => /Android was not measured/.test(note)));
});

// --- The route and the MCP tool, with a stand-in kernel ---------------------------

let dir: string;
let store: Store;
let launcher: Launcher;
let server: Server;
let base: string;
const argsCopy = () => join(dir, 'transport-args.json');

before(async () => {
  dir = await mkdtemp(join(tmpdir(), 'proteus-transport-test-'));
  store = new Store(dir);
  launcher = new Launcher(store, (_kernelPath, args) =>
    spawn(process.execPath, [join(here, 'stub-transport-kernel.mjs'), ...args],
          { stdio: 'ignore', env: { ...process.env, PROTEUS_STUB_ARGS_COPY: argsCopy() } }),
  async () => true);
  await writeFile(join(dir, 'kernel-placeholder'), '');
  await store.updateSettings({ kernelPath: join(dir, 'kernel-placeholder'), exitLookupUrl: '' });
  server = createApiServer({ store, launcher, uiDir: join(here, '..', 'ui') });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
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

test('GET /api/profiles/:id/transport measures the handshake and sets it beside the claim', async () => {
  assert.ok((await api('GET', '/api')).body.routes.includes('GET /api/profiles/:id/transport'));
  const proxy = { type: 'http', host: '127.0.0.1', port: 9, username: '', password: '' };
  const made = (await api('POST', '/api/profiles', { name: 'Shape', preset: 'windows-laptop', proxy, matchProxy: false })).body;

  const reply = await api('GET', `/api/profiles/${made.id}/transport`);
  assert.equal(reply.status, 200);
  const report = reply.body;
  assert.deepEqual(report.claims, { browser: 'Chrome', version: KERNEL, userAgent: made.userAgent });
  assert.deepEqual(report.kernel, { version: KERNEL });
  assert.equal(report.expected.ja4, STOCK_JA4);
  // The stand-in is Node, not Chrome: the report has to notice.
  assert.match(report.produces.tls.ja4, /^t1[23]d\d{4}h2_/);
  assert.notEqual(report.produces.tls.ja4, STOCK_JA4);
  assert.equal(report.agrees, false);
  assert.ok(report.differences.some((d: string) => d.startsWith('TLS: produced ')));
  assert.ok(report.differences.some((d: string) => d.startsWith('HTTP/2: produced ')));
  assert.equal(report.produces.userAgent, made.userAgent, 'the profile\'s settings were given to the kernel');

  // How the kernel was started for it: by itself, windowless, able to reach only the recorder.
  const args: string[] = JSON.parse(await readFile(argsCopy(), 'utf8'));
  assert.ok(args.includes('--headless=new'));
  assert.ok(args.includes('--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost'));
  assert.ok(!args.some((a) => a.startsWith('--proxy-server')), 'the profile\'s proxy is not used');
  assert.match(args[args.length - 1], /^https:\/\/localhost:\d+\/$/);
  const userDataDir = args.find((a) => a.startsWith('--user-data-dir='))!.slice(16);
  assert.ok(!userDataDir.startsWith(dir), 'not the profile\'s own browser data');
  await assert.rejects(readFile(join(userDataDir, '..', 'stub-args.json')), 'and the folder is removed afterwards');
  assert.ok(args.some((a) => a.startsWith('--disable-features=') && a.includes('AddTLSServerHandshakePadding')),
            'measured as the profile is started');

  // It changed nothing about the profile, running or not.
  const after = (await api('GET', `/api/profiles/${made.id}`)).body;
  assert.equal(after.state, 'stopped');
  assert.equal(after.updatedAt, made.updatedAt);

  // The same through MCP.
  const called = await api('POST', '/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/call',
                                            params: { name: 'transport_report', arguments: { id: made.id } } });
  const viaTool = JSON.parse(called.body.result.content[0].text);
  assert.equal(viaTool.claims.version, KERNEL);
  assert.equal(viaTool.produces.tls.ja4, report.produces.tls.ja4, 'the same client makes the same hello');

  assert.equal((await api('GET', '/api/profiles/no-such-profile/transport')).status, 404);
  assert.equal((await api('POST', `/api/profiles/${made.id}/transport`)).status, 405);
});

test('a kernel that cannot be measured is an error with a reason, not a guess', async () => {
  const made = (await api('POST', '/api/profiles', { name: 'Broken', matchProxy: false })).body;
  await store.updateSettings({ extraArgs: ['--stub-exit-now'] });
  try {
    const reply = await api('GET', `/api/profiles/${made.id}/transport`);
    assert.equal(reply.status, 502);
    assert.match(reply.body.error, /exited before it connected \(exit code 7\)/);
  } finally {
    await store.updateSettings({ extraArgs: [] });
  }
  await store.updateSettings({ kernelPath: join(dir, 'gone') });
  try {
    assert.equal((await api('GET', `/api/profiles/${made.id}/transport`)).status, 502);
  } finally {
    await store.updateSettings({ kernelPath: join(dir, 'kernel-placeholder') });
  }
});

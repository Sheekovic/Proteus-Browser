import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';

import { classify, identityFromCollected, parseCollected } from '../src/collected.ts';
import { buildKernelConfig } from '../src/kernelConfig.ts';
import { ValidationError } from '../src/profile.ts';
import { NotFoundError, Store } from '../src/store.ts';

const dataDir = mkdtempSync(join(tmpdir(), 'proteus-collected-'));
const store = new Store(dataDir);
after(() => rmSync(dataDir, { recursive: true, force: true }));

const KERNEL = '158.0.8127.37';

/** What the collector page produces on a Windows laptop running Chrome. */
function windowsLaptop(): Record<string, unknown> {
  return {
    format: 'proteus-fingerprint', version: 1, collectedAt: '2026-11-16T12:00:00.000Z', label: 'Office laptop',
    secureContext: true,
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
    platform: 'Win32', vendor: 'Google Inc.',
    uaData: {
      brands: [{ brand: 'Google Chrome', version: '141' }, { brand: 'Not?A_Brand', version: '8' }, { brand: 'Chromium', version: '141' }],
      fullVersionList: [], mobile: false, platform: 'Windows', platformVersion: '19.0.0', architecture: 'x86',
      bitness: '64', model: '', uaFullVersion: '141.0.7390.55', wow64: false,
    },
    hardwareConcurrency: 12, deviceMemory: 16, maxTouchPoints: 0,
    screen: { width: 1920, height: 1200, availWidth: 1920, availHeight: 1152, colorDepth: 24 },
    devicePixelRatio: 1.25, innerWidth: 1536, innerHeight: 730,
    webgl: { vendor: 'Google Inc. (Intel)', renderer: 'ANGLE (Intel, Intel(R) Iris(R) Xe Graphics (0x0000A7A0) Direct3D11 vs_5_0 ps_5_0, D3D11)' },
    webgpu: { vendor: 'intel', architecture: 'gen-12lp' },
    voices: [{ name: 'Microsoft David - English (United States)', lang: 'en-US', local: true, default: true }],
    fonts: ['Arial', 'Calibri', 'Segoe UI', 'Aptos'],
  };
}

function pixelPhone(): Record<string, unknown> {
  return {
    ...windowsLaptop(), label: '',
    userAgent: 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36',
    platform: 'Linux armv81',
    uaData: {
      brands: [{ brand: 'Chromium', version: '141' }, { brand: 'Google Chrome', version: '141' }],
      fullVersionList: [], mobile: true, platform: 'Android', platformVersion: '16.0.0', architecture: '',
      bitness: '', model: 'Pixel 9', uaFullVersion: '141.0.7390.70', wow64: false,
    },
    hardwareConcurrency: 8, deviceMemory: 8, maxTouchPoints: 5,
    screen: { width: 412, height: 923, availWidth: 412, availHeight: 923, colorDepth: 24 },
    devicePixelRatio: 2.625, innerWidth: 412, innerHeight: 785,
    webgl: { vendor: 'Google Inc. (ARM)', renderer: 'ANGLE (ARM, Mali-G715, OpenGL ES 3.2)' },
    webgpu: null, voices: [], fonts: ['Roboto'],
  };
}

function iphone(): Record<string, unknown> {
  return {
    ...windowsLaptop(), label: 'My iPhone',
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1',
    platform: 'iPhone', vendor: 'Apple Computer, Inc.', uaData: null,
    hardwareConcurrency: 4, deviceMemory: null, maxTouchPoints: 5,
    screen: { width: 393, height: 852, availWidth: 393, availHeight: 852, colorDepth: 24 },
    devicePixelRatio: 3, innerWidth: 393, innerHeight: 659,
    webgl: { vendor: 'Apple Inc.', renderer: 'Apple GPU' }, webgpu: null,
    voices: [{ name: 'Samantha', lang: 'en-US', local: true, default: true }], fonts: [],
  };
}

test('a Windows Chrome fingerprint becomes a Chrome profile of the kernel version on that hardware', () => {
  const identity = identityFromCollected(parseCollected(windowsLaptop()), KERNEL);
  assert.equal(identity.os, 'windows');
  assert.match(identity.userAgent, /Windows NT 10\.0; Win64; x64\) .* Chrome\/158\.0\.0\.0 Safari\/537\.36$/);
  assert.equal(identity.uaData.fullVersion, KERNEL, 'the version is the kernel\'s, not the collected browser\'s');
  assert.equal(identity.uaData.platformVersion, '19.0.0');
  assert.equal(identity.hardwareConcurrency, 12);
  assert.equal(identity.deviceMemory, 16);
  assert.deepEqual(identity.screen, { width: 1920, height: 1200, availWidth: 1920, availHeight: 1152, colorDepth: 24 });
  assert.match(identity.webgl.renderer, /Iris\(R\) Xe/);
  assert.deepEqual(identity.webgpu, { vendor: 'intel', architecture: 'gen-12lp' });
  assert.deepEqual(identity.fonts, ['Arial', 'Calibri', 'Segoe UI', 'Aptos']);
  assert.equal(identity.mobile, null);
});

test('phones keep their model, page area and touch', () => {
  const pixel = identityFromCollected(parseCollected(pixelPhone()), KERNEL);
  assert.equal(pixel.os, 'android');
  assert.match(pixel.userAgent, /Linux; Android 10; K\) .* Chrome\/158\.0\.0\.0 Mobile Safari\/537\.36$/);
  assert.equal(pixel.uaData.model, 'Pixel 9');
  assert.equal(pixel.uaData.mobile, true);
  assert.deepEqual(pixel.mobile, { viewWidth: 412, viewHeight: 785, deviceScaleFactor: 2.625, maxTouchPoints: 5 });
  assert.deepEqual(pixel.fonts, ['Roboto'], 'the fonts the phone itself reported');
  const noFonts = identityFromCollected(parseCollected({ ...pixelPhone(), fonts: [] }), KERNEL);
  assert.ok(noFonts.fonts.includes('Roboto') && !noFonts.fonts.includes('Segoe UI'), 'else those of Android');

  const apple = identityFromCollected(parseCollected(iphone()), KERNEL);
  assert.equal(apple.os, 'ios');
  assert.match(apple.userAgent, /Version\/18\.6 Mobile\/15E148 Safari\/604\.1$/, 'Safari keeps its own user agent');
  assert.deepEqual(apple.mobile, { viewWidth: 393, viewHeight: 659, deviceScaleFactor: 3, maxTouchPoints: 5 });
  assert.equal(apple.webgl.renderer, 'Apple GPU');
  assert.ok(apple.fonts.includes('Helvetica Neue') && !apple.fonts.includes('Segoe UI'), 'iOS fonts, not those of the machine');
});

test('two profiles from one fingerprint are the same model with different seeds', () => {
  const collected = parseCollected(windowsLaptop());
  const a = identityFromCollected(collected, KERNEL);
  const b = identityFromCollected(collected, KERNEL);
  assert.notEqual(a.seed, b.seed);
  assert.deepEqual({ ...a, seed: '' }, { ...b, seed: '' });
});

test('browsers the kernel cannot pass for are refused', () => {
  const firefox = { ...windowsLaptop(), uaData: null, vendor: '',
                    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:140.0) Gecko/20100101 Firefox/140.0' };
  assert.throws(() => classify(parseCollected(firefox)), /Chrome-family/);
  const desktopSafari = { ...iphone(), platform: 'MacIntel',
                          userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15' };
  assert.throws(() => classify(parseCollected(desktopSafari)), ValidationError);
  // Chrome on an iPhone is WebKit with a Chrome label; not something to reproduce.
  const chromeOnIphone = { ...iphone(), userAgent: String(iphone().userAgent).replace('Version/18.6', 'CriOS/141.0.7390.41') };
  assert.throws(() => classify(parseCollected(chromeOnIphone)), ValidationError);
});

test('malformed and hostile fingerprint files are refused', () => {
  assert.throws(() => parseCollected(null), ValidationError);
  assert.throws(() => parseCollected({ format: 'something-else', version: 1 }), /not a Proteus fingerprint/);
  assert.throws(() => parseCollected({ ...windowsLaptop(), version: 2 }), /not supported/);
  assert.throws(() => parseCollected({ ...windowsLaptop(), userAgent: 'x'.repeat(5000) }), ValidationError);
  assert.throws(() => parseCollected({ ...windowsLaptop(), userAgent: 'Mozilla\r\nX-Injected: 1' }), ValidationError);
  assert.throws(() => parseCollected({ ...windowsLaptop(), screen: { width: 1e9, height: 1, availWidth: 1, availHeight: 1, colorDepth: 24 } }), ValidationError);
  assert.throws(() => parseCollected({ ...windowsLaptop(), fonts: 'Arial' }), ValidationError);
  assert.throws(() => parseCollected({ ...windowsLaptop(), voices: [{ name: 5 }] }), ValidationError);
  // Unknown fields are dropped, not stored.
  const parsed = parseCollected({ ...windowsLaptop(), extra: { anything: true }, __proto__: { polluted: true } });
  assert.ok(!('extra' in parsed) && !('polluted' in parsed));
});

test('odd but real values are brought into range rather than refused', () => {
  const odd = parseCollected({ ...pixelPhone(), deviceMemory: 12, hardwareConcurrency: 0, innerWidth: 980, innerHeight: 1869,
                               screen: { width: 412, height: 923, availWidth: 412, availHeight: 923, colorDepth: 16 } });
  const identity = identityFromCollected(odd, KERNEL);
  assert.equal(identity.deviceMemory, 8, 'a value Chrome never reports falls back');
  assert.equal(identity.hardwareConcurrency, 4);
  assert.equal(identity.screen.colorDepth, 24);
  // The page was zoomed out when read (no viewport tag): the screen is used instead.
  assert.deepEqual([identity.mobile?.viewWidth, identity.mobile?.viewHeight], [412, 793]);
});

test('fingerprints are stored once, listed, used for profiles and deleted', async () => {
  const stored = await store.addFingerprint(windowsLaptop());
  const again = await store.addFingerprint({ ...windowsLaptop(), collectedAt: '2027-01-01T00:00:00.000Z', label: 'Renamed' });
  assert.equal(again.id, stored.id, 'the same reading is not stored twice');
  await store.addFingerprint(pixelPhone());
  assert.equal((await store.listFingerprints()).length, 2);
  await assert.rejects(store.addFingerprint({ ...windowsLaptop(), uaData: null, vendor: '', userAgent: 'Mozilla/5.0 Firefox/140.0' }), ValidationError);

  const profile = await store.createProfile({ name: 'From laptop' }, stored.id);
  assert.equal(profile.os, 'windows');
  assert.equal(profile.screen.height, 1200);
  assert.equal(profile.hardwareConcurrency, 12);
  assert.equal((await store.getProfile(profile.id)).webgpu.architecture, 'gen-12lp');
  // Fields given explicitly still win, and a contradicting system is refused.
  const renamed = await store.createProfile({ name: 'Other', hardwareConcurrency: 6 }, stored.id);
  assert.equal(renamed.hardwareConcurrency, 6);
  await assert.rejects(store.createProfile({ os: 'macos' }, stored.id), /windows device/);
  await assert.rejects(store.createProfile({}, '00000000-0000-4000-8000-000000000000'), NotFoundError);
  await assert.rejects(store.createProfile({}, '../../settings'), NotFoundError);

  await store.deleteFingerprint(stored.id);
  assert.equal((await store.listFingerprints()).length, 1);
  assert.equal((await store.getProfile(profile.id)).screen.height, 1200, 'profiles made from it are unaffected');
});

test('a profile from the largest fingerprint still fits the kernel command line', async () => {
  const fonts = Array.from({ length: 400 }, (_, i) => `Some Rather Long Font Family Name ${i}`);
  const voices = Array.from({ length: 300 }, (_, i) =>
      ({ name: `Microsoft Voice Number ${i} - English (United States)`, lang: 'en-US', local: true, default: i === 0 }));
  const stored = await store.addFingerprint({ ...windowsLaptop(), fonts, voices });
  const profile = await store.createProfile({ name: 'Big' }, stored.id);
  const bytes = Buffer.byteLength(JSON.stringify(buildKernelConfig(profile)));
  assert.ok(bytes < 16_000, `${bytes} bytes`);
});

/** WebGL capabilities as the collector reads them (shortened). */
function caps(): Record<string, unknown> {
  const s = Array.from({ length: 36 }, (_, i) => (i % 3 === 2 ? 23 : 127));
  return {
    '1': { p: { '3379': 16384, '3386': [32767, 32767], '33901': [1, 1024], '34047': 16 },
           e: ['ANGLE_instanced_arrays', 'EXT_texture_filter_anisotropic', 'WEBGL_debug_renderer_info'], s },
    '2': { p: { '3379': 16384, '32883': 2048, '36203': 4294967295 }, e: ['EXT_color_buffer_float'], s },
  };
}

test('a card\'s WebGL capabilities travel from the reading to the kernel config', async () => {
  const stored = await store.addFingerprint({ ...windowsLaptop(), webglCaps: caps(), label: 'With capabilities' });
  const profile = await store.createProfile({ name: 'Caps' }, stored.id);
  assert.deepEqual(profile.webglCaps, caps());
  assert.deepEqual(buildKernelConfig(profile).webglCaps, caps());
  // A generated identity names a card but has no reading of it: nothing is sent.
  const generated = await store.createProfile({ os: 'windows' });
  assert.equal(generated.webglCaps, null);
  assert.ok(!('webglCaps' in buildKernelConfig(generated)));
  // A reading made before the collector read capabilities still loads.
  assert.equal(identityFromCollected(parseCollected(windowsLaptop()), KERNEL).webglCaps, null);
});

test('malformed WebGL capabilities are refused, in a reading and in a profile', async () => {
  const bad: unknown[] = [
    'yes',
    { '1': { p: { MAX_TEXTURE_SIZE: 4096 } } },
    { '1': { p: { '3379': 'big' } } },
    { '1': { p: { '3379': [1, 2, 3, 4, 5] } } },
    { '1': { e: ['OES_texture_float', 'has space'] } },
    { '1': { e: ['<script>'] } },
    { '2': { s: [1, 2, 3] } },
    { '1': { p: Object.fromEntries(Array.from({ length: 200 }, (_, i) => [String(1000 + i), 1])) } },
  ];
  for (const webglCaps of bad) {
    assert.throws(() => parseCollected({ ...windowsLaptop(), webglCaps }), ValidationError, JSON.stringify(webglCaps).slice(0, 60));
    await assert.rejects(store.createProfile({ webglCaps: webglCaps as never }), ValidationError);
  }
  // Unknown keys are dropped; an empty object means "none".
  const cleaned = parseCollected({ ...windowsLaptop(), webglCaps: { '1': { p: { '3379': 8 }, extra: 1 }, '3': {} } }).webglCaps;
  assert.deepEqual(cleaned, { '1': { p: { '3379': 8 } } });
  assert.equal(parseCollected({ ...windowsLaptop(), webglCaps: {} }).webglCaps, null);
});

test('the largest reading with full capabilities still fits the kernel command line', async () => {
  const fonts = Array.from({ length: 400 }, (_, i) => `Some Rather Long Font Family Name ${i}`);
  const voices = Array.from({ length: 300 }, (_, i) =>
      ({ name: `Microsoft Voice Number ${i} - English (United States)`, lang: 'en-US', local: true, default: i === 0 }));
  const p = Object.fromEntries(Array.from({ length: 45 }, (_, i) => [String(30000 + i), 4294967295]));
  const e = Array.from({ length: 45 }, (_, i) => `WEBGL_some_long_extension_name_${i}`);
  const s = Array.from({ length: 36 }, () => 127);
  const stored = await store.addFingerprint({ ...windowsLaptop(), fonts, voices, webglCaps: { '1': { p, e, s }, '2': { p, e, s } } });
  const profile = await store.createProfile({ name: 'Biggest' }, stored.id);
  const bytes = Buffer.byteLength(JSON.stringify(buildKernelConfig(profile)));
  assert.ok(bytes < 16_000, `${bytes} bytes`);
});

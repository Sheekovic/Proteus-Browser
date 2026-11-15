import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';

import { generateIdentity } from '../src/fingerprint.ts';
import { buildFontSubstitutes, kindOf } from '../src/fontSubstitutes.ts';
import { buildKernelArgs, buildKernelConfig } from '../src/kernelConfig.ts';
import { ValidationError } from '../src/profile.ts';
import { NotFoundError, Store } from '../src/store.ts';

let dir: string;
let store: Store;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'proteus-test-'));
  store = new Store(dir);
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

test('a generated identity is internally consistent for each OS', () => {
  const expectations = {
    windows: { ua: 'Windows NT 10.0', platform: 'Win32', ch: 'Windows', gpu: 'Direct3D11' },
    linux: { ua: 'X11; Linux x86_64', platform: 'Linux x86_64', ch: 'Linux', gpu: 'OpenGL' },
    macos: { ua: 'Macintosh', platform: 'MacIntel', ch: 'macOS', gpu: 'Metal' },
  } as const;
  for (const os of ['windows', 'linux', 'macos'] as const) {
    for (let i = 0; i < 25; i++) {
      const id = generateIdentity(os, '158.0.8127.37');
      const expected = expectations[os];
      assert.ok(id.userAgent.includes(expected.ua), `${os} user agent: ${id.userAgent}`);
      assert.ok(id.userAgent.includes('Chrome/158.0.0.0'));
      assert.equal(id.platform, expected.platform);
      assert.equal(id.uaData.platform, expected.ch);
      assert.equal(id.uaData.fullVersion, '158.0.8127.37');
      assert.equal(id.uaData.brand, 'Google Chrome', 'the kernel is asked to generate the brand lists');
      assert.deepEqual(id.uaData.brands, []);
      assert.ok(id.webgl.renderer.includes(expected.gpu), `${os} GPU: ${id.webgl.renderer}`);
      assert.ok(id.screen.availHeight <= id.screen.height);
      assert.match(id.seed, /^[1-9]\d*$/);
    }
  }
});

test('two generated identities get different seeds', () => {
  const a = generateIdentity('windows', '158.0.8127.37');
  const b = generateIdentity('windows', '158.0.8127.37');
  assert.notEqual(a.seed, b.seed);
});

test('profiles are created, listed, updated and deleted on disk', async () => {
  const created = await store.createProfile({ name: 'Shop A', os: 'windows', timezone: 'Europe/Berlin' });
  assert.equal(created.name, 'Shop A');
  assert.equal(created.platform, 'Win32');

  const onDisk = JSON.parse(await readFile(join(dir, 'profiles', created.id, 'profile.json'), 'utf8'));
  assert.deepEqual(onDisk, created);

  await store.createProfile({ name: 'Shop B' });
  assert.deepEqual((await store.listProfiles()).map((p) => p.name), ['Shop A', 'Shop B']);

  const updated = await store.updateProfile(created.id, { languages: ['de-DE', 'de'], notes: 'main account' });
  assert.deepEqual(updated.languages, ['de-DE', 'de']);
  assert.equal(updated.seed, created.seed, 'editing must not change the identity seed');
  assert.equal(updated.createdAt, created.createdAt);

  await store.deleteProfile(created.id);
  assert.deepEqual((await store.listProfiles()).map((p) => p.name), ['Shop B']);
  await assert.rejects(store.getProfile(created.id), NotFoundError);
});

test('invalid profile values are rejected and nothing is saved', async () => {
  const profile = await store.createProfile({ name: 'ok' });
  const bad: Record<string, unknown>[] = [
    { name: '   ' },
    { timezone: 'Mars/Olympus_Mons' },
    { languages: ['not a language!'] },
    { hardwareConcurrency: 0 },
    { deviceMemory: 3 },
    { seed: '18446744073709551616' },
    { seed: '-5' },
    { screen: { width: 1920, height: 1080, availWidth: 4000, availHeight: 1040, colorDepth: 24 } },
    { proxy: { type: 'ftp', host: 'example.com', port: 21 } },
    { proxy: { type: 'http', host: 'bad host;rm', port: 8080 } },
    { startUrl: 'javascript:alert(1)' },
  ];
  for (const input of bad) {
    await assert.rejects(store.updateProfile(profile.id, input), ValidationError, JSON.stringify(input));
  }
  assert.deepEqual(await store.getProfile(profile.id), profile);
});

test('profile ids cannot be used to reach outside the data directory', async () => {
  for (const id of ['..', '../..', '..\\..', 'a/b', '']) {
    await assert.rejects(store.getProfile(id), NotFoundError, id);
    assert.throws(() => store.profileDir(id), NotFoundError);
  }
});

test('settings persist and are validated', async () => {
  assert.equal((await store.getSettings()).kernelPath, '');
  await store.updateSettings({ kernelPath: '/opt/kernel/chrome', extraArgs: ['--headless=new'] });
  const reloaded = await new Store(dir).getSettings();
  assert.equal(reloaded.kernelPath, '/opt/kernel/chrome');
  assert.deepEqual(reloaded.extraArgs, ['--headless=new']);
  await assert.rejects(store.updateSettings({ kernelVersion: 'latest' }), ValidationError);
});

test('the kernel config carries every setting the kernel patches read', async () => {
  const profile = await store.createProfile({
    os: 'windows', languages: ['de-DE', 'de'], timezone: 'Europe/Berlin',
  });
  const config = buildKernelConfig(profile);
  assert.deepEqual(Object.keys(config).sort(), [
    'audioNoise', 'canvasNoise', 'deviceMemory', 'fontAliases', 'fonts', 'hardwareConcurrency', 'languages',
    'platform',
    'screen', 'seed', 'timezone', 'uaData', 'userAgent', 'webRtcPolicy', 'webglRenderer', 'webglVendor',
  ]);
  assert.equal(config.webRtcPolicy, 'proxyOnly', 'new profiles hide the real IP from WebRTC by default');
  assert.equal(config.seed, profile.seed);
  assert.equal(config.webglRenderer, profile.webgl.renderer);

  assert.ok((config.fonts as string[]).includes('Segoe UI'), 'a Windows profile exposes Windows fonts');
  assert.ok(!(config.fonts as string[]).includes('Helvetica Neue'), 'and not macOS-only ones');

  // Unset languages and time zone are left out, so the kernel reports the real ones;
  // an empty font list likewise means "do not filter".
  const plain = buildKernelConfig(await store.createProfile({ fonts: [] }));
  assert.ok(!('languages' in plain) && !('timezone' in plain) && !('fonts' in plain));
  assert.ok(!('fontAliases' in plain));
});

test('every claimed font gets substitutes of its own kind', () => {
  assert.equal(kindOf('DejaVu Sans Mono'), 'mono');
  assert.equal(kindOf('Menlo'), 'mono');
  assert.equal(kindOf('Microsoft Sans Serif'), 'sans');
  assert.equal(kindOf('Times New Roman'), 'serif');
  assert.equal(kindOf('Helvetica Neue'), 'sans');

  const fonts = ['Helvetica Neue', 'Menlo', 'Georgia', 'Avenir', 'Geneva'];
  const subs = buildFontSubstitutes(fonts);
  assert.deepEqual(Object.keys(subs), fonts);
  for (const font of fonts) {
    assert.ok(subs[font].length >= 8, `${font} has a long fallback chain`);
    assert.ok(!subs[font].includes(font), `${font} is not its own substitute`);
    assert.ok(subs[font].every((s) => kindOf(s) === kindOf(font)), `${font} substitutes share its kind`);
    assert.equal(new Set(subs[font]).size, subs[font].length, 'no duplicates');
  }
  assert.ok(subs.Menlo.includes('Consolas') && subs.Menlo.includes('DejaVu Sans Mono'),
    'a list covers fonts from more than one host system');
  assert.deepEqual(buildFontSubstitutes(fonts), subs, 'the choice is stable between launches');
  assert.notDeepEqual(subs.Avenir, subs.Geneva, 'different fonts start from different stand-ins');
});

test('a profile saved before the WebRTC setting existed loads as protected', async () => {
  const profile = await store.createProfile({ name: 'Old' });
  const file = join(dir, 'profiles', profile.id, 'profile.json');
  const { webrtc: _removed, ...older } = JSON.parse(await readFile(file, 'utf8'));
  await writeFile(file, JSON.stringify(older));

  assert.equal((await store.getProfile(profile.id)).webrtc, 'proxyOnly');
  assert.equal((await store.listProfiles())[0].webrtc, 'proxyOnly');
  // It can still be edited, and the setting can be turned off explicitly.
  assert.equal((await store.updateProfile(profile.id, { webrtc: 'real' })).webrtc, 'real');
  await assert.rejects(store.updateProfile(profile.id, { webrtc: 'maybe' as never }), ValidationError);
});

test('the WebRTC public address is validated and only sent while protected', async () => {
  const profile = await store.createProfile({ name: 'Proxy', webrtcPublicIp: '203.0.113.7' });
  assert.equal(buildKernelConfig(profile).webRtcPublicIp, '203.0.113.7');

  const v6 = await store.updateProfile(profile.id, { webrtcPublicIp: '2001:db8::7' });
  assert.equal(buildKernelConfig(v6).webRtcPublicIp, '2001:db8::7');

  // With protection off the real addresses are shown, so the setting is not passed on.
  const real = await store.updateProfile(profile.id, { webrtc: 'real' });
  assert.ok(!('webRtcPublicIp' in buildKernelConfig(real)));

  for (const bad of ['not-an-ip', '203.0.113.7:8080', '999.1.1.1', 'example.com', '1.2.3.4 typ host']) {
    await assert.rejects(store.updateProfile(profile.id, { webrtcPublicIp: bad }), ValidationError, bad);
  }
  // A new profile shows no address until one is given.
  assert.ok(!('webRtcPublicIp' in buildKernelConfig(await store.createProfile({}))));
});

test('kernel arguments reflect the profile', async () => {
  const profile = await store.createProfile({
    languages: ['fr-FR'], proxy: { type: 'socks5', host: '10.0.0.5', port: 1080 },
    startUrl: 'https://example.com/',
  });
  const args = buildKernelArgs(profile, { userDataDir: '/data/browser', configFile: '/data/kernel.json' },
    ['--extra-flag']);
  assert.ok(args.includes('--user-data-dir=/data/browser'));
  assert.ok(args.includes('--proteus-config=/data/kernel.json'));
  assert.ok(args.includes('--lang=fr-FR'));
  assert.ok(args.includes('--proxy-server=socks5://10.0.0.5:1080'));
  assert.ok(args.includes(`--window-size=${profile.screen.availWidth},${profile.screen.availHeight}`));
  assert.ok(args.includes('--extra-flag'));
  assert.equal(args.at(-1), 'https://example.com/', 'the start URL comes last');
});

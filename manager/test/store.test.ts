import { safariReading } from '../src/surface.ts';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';

import { generateIdentity } from '../src/fingerprint.ts';
import { buildFontSubstitutes, SHIPPED_FONTS, kindOf } from '../src/fontSubstitutes.ts';
import { buildKernelArgs, buildKernelConfig, MAX_PACKED_CONFIG, packedConfigLength } from '../src/kernelConfig.ts';
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

test('WebGPU info and voices agree with the rest of the identity', () => {
  const gpuVendor = { Intel: 'intel', NVIDIA: 'nvidia', AMD: 'amd', Apple: 'apple' } as const;
  for (const os of ['windows', 'linux', 'macos'] as const) {
    for (let i = 0; i < 40; i++) {
      const id = generateIdentity(os, '158.0.8127.37');
      // The WebGPU vendor names the same manufacturer as the WebGL renderer string.
      const maker = Object.keys(gpuVendor).find((m) => id.webgl.renderer.includes(`(${m}`)) as
        keyof typeof gpuVendor;
      assert.ok(maker, id.webgl.renderer);
      assert.equal(id.webgpu.vendor, gpuVendor[maker], id.webgl.renderer);
      assert.notEqual(id.webgpu.architecture, '');
    }
  }
  const names = (os: 'windows' | 'linux' | 'macos') =>
    generateIdentity(os, '158.0.8127.37').voices.map((v) => v.name);
  assert.ok(names('windows').includes('Microsoft David - English (United States)'));
  assert.ok(names('macos').includes('Samantha') && !names('macos').some((n) => n.startsWith('Microsoft')));
  assert.ok(names('linux').every((n) => n.startsWith('Google ')), 'Linux has only Chrome\'s network voices');
  for (const os of ['windows', 'linux', 'macos'] as const) {
    const voices = generateIdentity(os, '158.0.8127.37').voices;
    assert.ok(voices.filter((v) => v.default).length <= 1, 'at most one default voice');
    assert.ok(voices.some((v) => v.name === 'Google US English' && !v.local));
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
    'audioNoise', 'battery', 'canvasNoise', 'deviceMemory', 'fontAliases', 'fonts', 'hardwareConcurrency', 'languages',
    'mediaDevices', 'platform',
    'screen', 'seed', 'timezone', 'uaData', 'userAgent', 'voices', 'webRtcPolicy', 'webglCaps', 'webglRenderer',
    'webglVendor', 'webgpu',
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
  const subs = buildFontSubstitutes(fonts, 'windows');
  assert.deepEqual(Object.keys(subs), fonts);
  for (const font of fonts) {
    assert.equal(subs[font].length, 3, `${font} has three stand-ins`);
    assert.ok(!subs[font].includes(font), `${font} is not its own substitute`);
    assert.ok(subs[font].every((s) => kindOf(s) === kindOf(font)), `${font} substitutes share its kind`);
    assert.equal(new Set(subs[font]).size, subs[font].length, 'no duplicates');
  }
  assert.ok(subs.Menlo.includes('Consolas'), 'stand-ins are fonts of the machine running the kernel');
  assert.ok(buildFontSubstitutes(fonts, 'linux').Menlo.every((s) => /DejaVu|Liberation|Nimbus|Noto|Ubuntu/.test(s)),
    'whichever system that is');
  assert.deepEqual(buildFontSubstitutes(fonts, 'windows'), subs, 'the choice is stable between launches');
  assert.notDeepEqual(subs.Avenir, subs.Geneva, 'different fonts start from different stand-ins');
});

test('with the fonts that come with Proteus, stand-ins are those and the same on every machine', async () => {
  const windows = buildFontSubstitutes(['Arial', 'Times New Roman', 'Courier New', 'Calibri', 'Avenir', 'Menlo'], { host: 'linux', shippedFor: 'macos' });
  assert.equal(windows.Arial[0], 'Arimo', 'the font with the same measures comes first');
  assert.deepEqual([windows['Times New Roman'][0], windows['Courier New'][0], windows.Calibri[0]], ['Tinos', 'Cousine', 'Carlito']);
  assert.ok(SHIPPED_FONTS.includes(windows.Avenir[0]) && SHIPPED_FONTS.includes(windows.Menlo[0]), 'a font without a counterpart gets shipped ones of its kind');
  for (const [font, list] of Object.entries(windows)) {
    assert.equal(list.length, 3, font);
    assert.deepEqual(list.slice(0, 2), buildFontSubstitutes([font], { host: 'windows', shippedFor: 'macos' })[font].slice(0, 2), `${font}: the same on another machine`);
    assert.ok(!SHIPPED_FONTS.includes(list[2]), `${font}: the last is the machine's, for a kernel without the folder`);
  }
  // Android answers to names it has no font for, with its own faces.
  const android = buildFontSubstitutes(['Arial', 'Georgia', 'Courier New', 'Monaco', 'Noto Sans CJK JP'], { host: 'windows', shippedFor: 'android' });
  assert.deepEqual(Object.values(android).map((list) => list[0]), ['Roboto', 'Noto Serif', 'Cutive Mono', 'Droid Sans Mono', 'Noto Sans JP']);

  const phone = await store.createProfile({ os: 'android' });
  const config = buildKernelConfig(phone, Date.now(), '/opt/proteus/fonts') as Record<string, any>;
  assert.equal(config.fontDir, '/opt/proteus/fonts');
  assert.equal(config.fontAliases.Arial[0], 'Roboto');
  assert.ok(!('fontDir' in buildKernelConfig(phone)), 'without the folder nothing is said of it');
  assert.ok(!('fontDir' in buildKernelConfig(await store.createProfile({ fonts: [] }), Date.now(), '/opt/proteus/fonts')), 'nor for a profile with the fonts of the machine');
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

test('the kernel configuration of a generated profile stays small', async () => {
  // The kernel passes it to each child process on the command line, which Windows
  // limits to 32,767 characters; a profile that outgrows it cannot start at all.
  for (const os of ['windows', 'macos', 'linux'] as const) {
    for (let i = 0; i < 5; i++) {
      const profile = await store.createProfile({
        os, languages: ['en-US', 'en'], timezone: 'Europe/Berlin', webrtcPublicIp: '203.0.113.7',
        geolocation: { latitude: 52.52, longitude: 13.405, accuracy: 40 },
      });
      const packed = packedConfigLength(JSON.stringify(buildKernelConfig(profile)));
      // As it travels to the kernel's child processes, deflated, with room to spare
      // for what a user adds: a start accepts MAX_PACKED_CONFIG characters.
      assert.ok(packed < MAX_PACKED_CONFIG * 0.6, `${os}: ${packed} characters packed`);
    }
  }
});

test('an iPhone profile is Safari, not Chrome', async () => {
  for (let i = 0; i < 8; i++) {
    const profile = await store.createProfile({ os: 'ios' });
    assert.match(profile.userAgent,
        /^Mozilla\/5\.0 \(iPhone; CPU iPhone OS 18_7 like Mac OS X\) AppleWebKit\/605\.1\.15 \(KHTML, like Gecko\) Version\/27\.2 Mobile\/15E148 Safari\/604\.1$/);
    assert.ok(!profile.userAgent.includes('Chrome'));
    assert.equal(profile.platform, 'iPhone');
    assert.deepEqual(profile.webgl, { vendor: 'Apple Inc.', renderer: 'Apple GPU' });
    assert.ok(profile.mobile);
    assert.equal(profile.mobile.deviceScaleFactor, 3);
    assert.ok(profile.voices.some((voice) => voice.name === 'Samantha' && voice.default));
    assert.ok(profile.fonts.includes('Helvetica Neue') && !profile.fonts.includes('Segoe UI') &&
              !profile.fonts.includes('Roboto'));
    const config = buildKernelConfig(profile) as Record<string, any>;
    assert.equal(config.vendor, 'Apple Computer, Inc.');
    assert.equal(config.clientHints, false);
    assert.equal(config.chromeObject, false);
    assert.ok(!('uaData' in config) && !('deviceMemory' in config));
    assert.ok(config.hide.Navigator.includes('getBattery'));
    for (const name of ['userAgentData', 'connection', 'deviceMemory']) {
      assert.ok(config.hide.Navigator.includes(name) && config.hide.WorkerNavigator.includes(name), name);
    }
    assert.equal(config.mobile.pdfViewer, true);
    // With everything Safari lacks and everything it has that the kernel lacks, read
    // from a phone, it is the largest configuration there is: some 72,000 bytes, a
    // third of that as it travels. A fifth of the room is left for what a user adds.
    const packed = packedConfigLength(JSON.stringify(config));
    assert.ok(packed < MAX_PACKED_CONFIG * 0.8, `${packed} characters packed`);
    // What Safari has and the kernel lacks is given to a page: interfaces, parents first.
    const names = config.add.interfaces.map((entry: { n: string }) => entry.n);
    assert.ok(names.includes('ApplePaySession') && names.includes('GestureEvent'), 'Safari’s own interfaces');
    assert.ok(names.indexOf('CSSValue') < names.indexOf('CSSPrimitiveValue'), 'a parent before its child');
    assert.equal(config.add.globals.ongesturestart, 'A');
    assert.equal(config.add.globals.webkitIndexedDB, '=indexedDB');
    assert.ok(!('describe' in config.add.globals) && !('readShapes' in config.add.globals), 'not the reading page’s own functions');
  }
  // None of this reaches a Chrome profile.
  const config = buildKernelConfig(await store.createProfile({ os: 'android' }));
  for (const key of ['vendor', 'clientHints', 'chromeObject']) assert.ok(!(key in config), key);
  const desktop = buildKernelConfig(await store.createProfile({ os: 'windows' }));
  assert.ok(!('hide' in desktop), 'the Chrome of a computer is what the kernel is: nothing is hidden');
});

test('a phone profile has no more of the web than its browser does', async () => {
  // Safari: what the kernel has and a real iPhone's Safari was read not to have.
  const iphone = await store.createProfile({ os: 'ios' });
  const safari = buildKernelConfig(iphone).hide;
  const hides = (name: string) => safari.globalThis.includes(name) ||
      safari.globalThis.some((entry: string) => entry.endsWith('*') && name.startsWith(entry.slice(0, -1)));
  for (const name of ['EyeDropper', 'showOpenFilePicker', 'USBDevice', 'XRSession', 'NavigatorUAData', 'Notification',
                      'PushManager', 'IdleDetector', 'Temporal', 'CloseWatcher', 'requestIdleCallback']) {
    assert.ok(hides(name), name);
  }
  assert.deepEqual(safari.Screen, ['isExtended', 'onchange']);
  for (const name of ['userAgentData', 'connection', 'getBattery', 'bluetooth', 'usb', 'getUserMedia', 'gpu']) {
    assert.ok(safari.Navigator.includes(name), name);
  }
  // What that Safari has is in no list: a missing interface shows as much as an extra one.
  for (const name of ['fetch', 'Worker', 'SharedWorker', 'PaymentRequest', 'ServiceWorker', 'KeyboardEvent', 'XMLHttpRequest',
                      'webkitSpeechRecognition', 'FileSystemHandle', 'ScreenOrientation', 'GPUDevice', 'WebTransport',
                      'requestAnimationFrame', 'CSSStyleSheet', 'HTMLElement', 'Promise', 'Intl']) {
    assert.ok(!hides(name), name);
  }
  for (const name of ['share', 'canShare', 'wakeLock', 'mediaSession', 'credentials', 'clipboard', 'geolocation', 'userAgent']) {
    assert.ok(!safari.Navigator.includes(name), name);
  }
  // Kept although Safari lacks it: without it the kernel could not play video in pieces.
  assert.ok(!hides('MediaSource') && !hides('SourceBuffer'));
  const reading = safariReading();
  assert.match(reading.readFrom, /iPhone; CPU iPhone OS .* Version\/[\d.]+ Mobile/);
  assert.ok(reading.cannotAdd.globals > 0, 'what the list cannot do is said');
  // Every member Safari was read not to have is hidden: none is left out for room.
  // What nothing can remove is counted: Symbol's two well-known symbols and the two
  // constants of the page's global object.
  assert.deepEqual(reading.notHidden, { members: 0, interfaces: 0, fixedStatics: 2, fixedConstants: 2 });
  // Static members go by the interface object ("Iterator."), what Safari has in a page
  // and not in a worker by the scope, and a constant that goes from one interface is
  // named where it stays.
  assert.deepEqual(safari['Iterator.'], ['zip', 'zipKeyed']);
  assert.deepEqual(safari.window, ['MediaStreamTrackProcessor']);
  assert.ok(safari.worker.includes('UserActivation') && !safari.globalThis.includes('UserActivation'));
  assert.ok(safari.WebGLRenderingContext.includes('RGB8') && safari['WebGLRenderingContext.'].includes('RGB8'));
  assert.deepEqual(buildKernelConfig(iphone).keepConstants, { WebGL2RenderingContext: ['RGB8', 'RGBA8'], Window: ['PERSISTENT', 'TEMPORARY'] });
  assert.ok(Object.keys(safari).length > 100 && Object.values(safari).flat().length > 550);
  assert.ok(!buildKernelArgs(iphone, { userDataDir: 'u', configFile: 'c' }, []).some((a) => a.startsWith('--enable-blink-features=')));

  // Chrome on a phone, as one was read before and after an update: no window sharing,
  // local fonts or built-in language models; it does have the keyboard map, the list of
  // screens, the colour picker and HID. And what only a phone has is switched on.
  const phone = await store.createProfile({ os: 'android' });
  const android = buildKernelConfig(phone).hide;
  assert.deepEqual(android.Navigator, ['registerProtocolHandler', 'unregisterProtocolHandler']);
  assert.ok(!('Screen' in android), 'a phone has the members for several screens');
  for (const name of ['queryLocalFonts', 'CaptureController', 'LanguageModel', 'documentPictureInPicture', 'PressureObserver']) {
    assert.ok(android.globalThis.includes(name), name);
  }
  for (const name of ['USB*', 'EyeDropper', 'HID*', 'HIDDevice', 'Keyboard', 'getScreenDetails', 'Notification', 'showOpenFilePicker']) {
    assert.ok(!android.globalThis.includes(name), name);
  }
  assert.deepEqual(android.MediaDevices, ['getDisplayMedia', 'setCaptureHandleConfig'], 'a phone cannot share its screen with a page');
  assert.ok(buildKernelArgs(phone, { userDataDir: 'u', configFile: 'c' }, [])
      .some((a) => a.startsWith('--enable-blink-features=ContactsManager,ContactsManagerExtraProperties,WebNFC,ContentIndex,DigitalGoods,BarcodeDetector,') &&
          a.includes('MediaCapture') && a.includes('GlobalPrivacyControl') && a.endsWith('WebTransportDraining')));
  // Every name is one the kernel's check of a member name lets through, and a pattern is a prefix.
  for (const list of [safari.globalThis, android.globalThis]) {
    for (const name of list) assert.match(name, /^[A-Za-z_$][A-Za-z0-9_$]{1,}\*?$/, name);
  }
  for (const os of ['windows', 'macos', 'linux'] as const) {
    assert.ok(!buildKernelArgs(await store.createProfile({ os }), { userDataDir: 'u', configFile: 'c' }, [])
        .some((a) => a.startsWith('--enable-blink-features=')), os);
  }
});

test('an Android profile is one real phone model, consistently', async () => {
  for (let i = 0; i < 12; i++) {
    const profile = await store.createProfile({ os: 'android' });
    assert.match(profile.userAgent, /^Mozilla\/5\.0 \(Linux; Android 10; K\) .* Mobile Safari\/537\.36$/);
    assert.equal(profile.platform, 'Linux armv81');
    assert.equal(profile.uaData.platform, 'Android');
    assert.equal(profile.uaData.mobile, true);
    assert.equal(profile.uaData.architecture, '', 'phones report no architecture hint');
    assert.ok(profile.uaData.model.length > 0);
    assert.ok(profile.mobile, 'a phone profile has phone settings');
    assert.equal(profile.mobile.viewWidth, profile.screen.width, 'the page spans the screen width');
    assert.ok(profile.mobile.viewHeight < profile.screen.height, 'the bars take some of the height');
    assert.ok(profile.screen.height > profile.screen.width, 'portrait');
    assert.match(profile.webgl.renderer, /^ANGLE \(ARM, Mali-G\d+.*, OpenGL ES 3\.2\)$/);
    assert.equal(profile.webgpu.vendor, 'arm');
    assert.ok(profile.voices.every((voice) => voice.local && !voice.name.startsWith('Google')));
    // A phone claims its own system's fonts and none of a desktop's.
    assert.ok(profile.fonts.includes('Roboto') && profile.fonts.includes('Noto Sans'));
    for (const desktop of ['Segoe UI', 'Calibri', 'Consolas', 'Helvetica Neue', 'DejaVu Sans']) {
      assert.ok(!profile.fonts.includes(desktop), desktop);
    }
    const config = buildKernelConfig(profile);
    assert.deepEqual(config.fonts, profile.fonts);
    assert.ok('Roboto' in (config.fontAliases as object), 'with stand-ins, since the machine lacks them');
    assert.deepEqual(config.mobile, profile.mobile);
    assert.ok(packedConfigLength(JSON.stringify(config)) < MAX_PACKED_CONFIG * 0.6);
  }
  // Desktop profiles are untouched, and bad phone settings are refused.
  const desktop = await store.createProfile({ os: 'windows' });
  assert.equal(desktop.mobile, null);
  assert.ok(!('mobile' in buildKernelConfig(desktop)));
  await assert.rejects(store.createProfile({ os: 'android', mobile: { viewWidth: 5000, viewHeight: 700, deviceScaleFactor: 2, maxTouchPoints: 5 } }), ValidationError);
});

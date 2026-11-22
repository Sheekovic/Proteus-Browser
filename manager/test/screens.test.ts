// Screens read from real computers (src/screens.json): a new identity takes one, with
// the pixel ratio it was read at, and the browser is started at that ratio.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { generateIdentity, readScreenCount } from '../src/fingerprint.ts';
import { buildKernelArgs } from '../src/kernelConfig.ts';
import { identityFromPreset, listPresets } from '../src/presets.ts';
import { type Profile, validateProfile } from '../src/profile.ts';

const KERNEL = '157.0.8103.79';
const file = JSON.parse(readFileSync(new URL('../src/screens.json', import.meta.url), 'utf8'));
const profileOf = (identity: object): Profile => ({
  ...identity, id: 'x', name: 'n', notes: '', createdAt: '', updatedAt: '', languages: [], timezone: '',
  webrtc: 'proxyOnly', webrtcPublicIp: '', geolocation: null, proxy: null, matchProxy: false, startUrl: '', tags: [],
} as unknown as Profile);
const scaleOf = (profile: Profile) =>
  buildKernelArgs(profile, { userDataDir: 'u', configFile: 'c' }, []).find((arg) => arg.startsWith('--force-device-scale-factor='));

test('the file of screens holds screens a person\'s computer has, each with its pixel ratio', () => {
  assert.match(file.source, /Apache License 2\.0/);
  for (const os of ['windows', 'macos', 'linux']) {
    assert.ok(file.screens[os].length >= 15, `${os}: ${file.screens[os].length} screens`);
    for (const screen of file.screens[os]) {
      const name = `${os} ${screen.width}x${screen.height}`;
      assert.ok(screen.width >= 1280 && screen.width > screen.height, `${name}: wider than high`);
      assert.ok(screen.availWidth <= screen.width && screen.availHeight <= screen.height, `${name}: the work area fits`);
      assert.ok([1, 1.25, 1.5, 1.75, 2, 2.25, 2.5, 3].includes(screen.devicePixelRatio), `${name}: ratio ${screen.devicePixelRatio}`);
      assert.ok([24, 30].includes(screen.colorDepth) && screen.weight > 0, name);
      if (os !== 'linux') assert.ok(screen.availHeight < screen.height, `${name}: a taskbar or menu bar takes part of it`);
    }
  }
  // Size and ratio together: the 125% laptop screen is there at 1.25 and at nothing else.
  const laptop = file.screens.windows.filter((screen: any) => screen.width === 1536 && screen.height === 864);
  assert.ok(laptop.length > 0 && laptop.every((screen: any) => screen.devicePixelRatio === 1.25));
  assert.ok(file.screens.windows.filter((screen: any) => screen.width === 1920 && screen.height === 1080)
      .every((screen: any) => screen.devicePixelRatio === 1));
});

test('a new identity has a screen that was read, and its browser is started at that screen\'s pixel ratio', () => {
  for (const os of ['windows', 'macos', 'linux'] as const) {
    const sizes = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const identity = generateIdentity(os, KERNEL);
      const read = file.screens[os].find((screen: any) => {
        const { weight: _weight, ...rest } = screen;
        return JSON.stringify(rest) === JSON.stringify(identity.screen);
      });
      assert.ok(read, `${os}: ${JSON.stringify(identity.screen)} was read`);
      sizes.add(`${identity.screen.width}x${identity.screen.height}@${identity.screen.devicePixelRatio}`);
      const profile = profileOf(identity);
      validateProfile(profile);
      assert.equal(scaleOf(profile), `--force-device-scale-factor=${identity.screen.devicePixelRatio}`);
      if (os === 'macos') {
        // A laptop's own screen goes with the laptop: no 16-inch panel on an Air's chip,
        // and a desktop Mac (Ultra) has a monitor plugged in.
        const size = `${identity.screen.width}x${identity.screen.height}`;
        const chip = identity.webgl.renderer;
        if (size === '1728x1117') assert.match(chip, /Apple M\d (Pro|Max),/, `${size} on ${chip}`);
        if (size === '1470x956') assert.match(chip, /Apple M[2-9],/, `${size} on ${chip}`);
        if (/Ultra/.test(chip)) assert.ok(['1920x1080', '2560x1440', '3008x1692', '3840x2160', '5120x2160'].includes(size), `${size} on ${chip}`);
      }
    }
    assert.ok(sizes.size >= 5, `${os}: ${sizes.size} different screens in 200 identities`);
    assert.ok(readScreenCount(os) >= sizes.size);
  }
});

test('a ready-made setup\'s screen has its ratio too; a phone and an older profile are left alone', () => {
  const ratios = Object.fromEntries(listPresets().map((preset) => [preset.id, identityFromPreset(preset.id, KERNEL)]));
  assert.equal(ratios['windows-office-laptop'].screen.devicePixelRatio, 1.25, '1536 by 864 is a panel at 125%');
  assert.equal(ratios['windows-desktop'].screen.devicePixelRatio, 1);
  assert.deepEqual([ratios['macbook-air'].screen.devicePixelRatio, ratios['macbook-air'].screen.colorDepth], [2, 30]);
  for (const id of ['pixel-8', 'iphone-15']) {
    assert.equal(ratios[id].screen.devicePixelRatio, undefined, `${id}: a phone's ratio is in its emulation`);
    assert.equal(scaleOf(profileOf(ratios[id])), undefined);
  }
  // A profile made before screens had a ratio starts at the host's scale, as it did.
  const older = profileOf(generateIdentity('windows', KERNEL));
  delete older.screen.devicePixelRatio;
  validateProfile(older);
  assert.equal(scaleOf(older), undefined);
  for (const bad of [0.5, 5, '2']) {
    assert.throws(() => validateProfile({ ...older, screen: { ...older.screen, devicePixelRatio: bad as number } }), /devicePixelRatio/);
  }
});

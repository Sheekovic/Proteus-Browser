// A profile's memory value is one its browser can report; ready-made setups; and the
// lists a profile used to take from the machine at every start.

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { identityFromCollected, parseCollected } from '../src/collected.ts';
import { generateIdentity } from '../src/fingerprint.ts';
import { borrowedLists, listsToKeep } from '../src/hostLists.ts';
import { buildKernelConfig } from '../src/kernelConfig.ts';
import { Launcher } from '../src/launcher.ts';
import { identityFromPreset, listPresets } from '../src/presets.ts';
import { deviceMemoryValuesFor, OS_FAMILIES, type Profile, ValidationError } from '../src/profile.ts';
import { Store } from '../src/store.ts';

const KERNEL = '158.0.8127.37';
const here = dirname(fileURLToPath(import.meta.url));

let dir: string;
let store: Store;

before(async () => {
  dir = await mkdtemp(join(tmpdir(), 'proteus-realism-'));
  store = new Store(dir);
  await writeFile(join(dir, 'kernel'), '');
  await store.updateSettings({ kernelPath: join(dir, 'kernel'), exitLookupUrl: '' });
});

after(async () => {
  await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

// --- Memory ----------------------------------------------------------------------------

test('a generated profile has a memory value its browser can report, fitting its processor', () => {
  assert.deepEqual(deviceMemoryValuesFor('windows'), [2, 4, 8, 16, 32]);
  assert.deepEqual(deviceMemoryValuesFor('android'), [1, 2, 4, 8], 'Chrome on a phone stops at 8');
  for (const os of OS_FAMILIES) {
    for (let i = 0; i < 300; i++) {
      const identity = generateIdentity(os, KERNEL);
      assert.ok(deviceMemoryValuesFor(os).includes(identity.deviceMemory), `${os}: ${identity.deviceMemory}`);
      if (os === 'android' || os === 'ios') continue;
      // Processor and memory are sold together: no 32 GB beside four cores, at least 8 GB on a computer.
      assert.ok(identity.deviceMemory >= 8, `${os}: ${identity.deviceMemory} GB`);
      if (identity.hardwareConcurrency <= 8) assert.ok(identity.deviceMemory <= 16, `${os}: ${identity.hardwareConcurrency} cores, ${identity.deviceMemory} GB`);
      if (os === 'macos' && /Apple M[12],/.test(identity.webgl.renderer)) assert.equal(identity.hardwareConcurrency, 8, 'an M1 or M2 has eight cores');
    }
  }
});

test('a memory value set by hand is checked against the profile\'s system', async () => {
  const phone = await store.createProfile({ os: 'android' });
  const computer = await store.createProfile({ os: 'windows' });

  // Legal for one system is not legal for another.
  assert.equal((await store.updateProfile(computer.id, { deviceMemory: 16 })).deviceMemory, 16);
  assert.equal((await store.updateProfile(phone.id, { deviceMemory: 4 })).deviceMemory, 4);
  await assert.rejects(store.updateProfile(phone.id, { deviceMemory: 16 }),
      (error: Error) => error instanceof ValidationError && /1, 2, 4, 8 for a android profile/.test(error.message));
  for (const bad of [0.5, 1, 3, 64, '8', null]) {
    await assert.rejects(store.updateProfile(computer.id, { deviceMemory: bad as never }), ValidationError, String(bad));
  }
  assert.equal((await store.getProfile(computer.id)).deviceMemory, 16, 'a refused value changes nothing');

  // At creation too, and when the system is what changes.
  await assert.rejects(store.createProfile({ os: 'android', deviceMemory: 32 }), ValidationError);
  await assert.rejects(store.createProfile({ os: 'linux', deviceMemory: 0.25 }), ValidationError);
  assert.equal((await store.createProfile({ os: 'macos', deviceMemory: 32 })).deviceMemory, 32);
  await store.updateProfile(computer.id, { deviceMemory: 32 });
  await assert.rejects(store.updateProfile(computer.id, { os: 'android' }), ValidationError,
      'a phone cannot keep a computer\'s 32 GB');

  // A device reading with a value that system's Chrome does not report is brought back.
  const reading = parseCollected({
    format: 'proteus-fingerprint', version: 1, collectedAt: '2026-01-01T00:00:00.000Z', label: '', secureContext: true,
    userAgent: 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36',
    platform: 'Linux armv81', vendor: 'Google Inc.', uaData: null, hardwareConcurrency: 8, deviceMemory: 16, maxTouchPoints: 5,
    screen: { width: 412, height: 923, availWidth: 412, availHeight: 923, colorDepth: 24 }, devicePixelRatio: 2.625,
    innerWidth: 412, innerHeight: 785, webgl: null, webgpu: null, voices: [], fonts: [],
  });
  assert.equal(identityFromCollected(reading, KERNEL).deviceMemory, 8);
});

test('a profile saved with a value no longer offered keeps loading, saving and starting', async () => {
  // As an earlier version could have stored it: 0.5 GB on a Windows profile.
  const made = await store.createProfile({ os: 'windows', name: 'Old' });
  const file = join(store.profileDir(made.id), 'profile.json');
  await writeFile(file, JSON.stringify({ ...made, deviceMemory: 0.5 }));

  assert.equal((await store.getProfile(made.id)).deviceMemory, 0.5);
  const renamed = await store.updateProfile(made.id, { name: 'Old, renamed', timezone: 'Europe/Berlin' });
  assert.equal(renamed.deviceMemory, 0.5, 'editing something else leaves it alone');
  assert.equal(buildKernelConfig(renamed).deviceMemory, 0.5);
  // Touching the value itself holds it to the rule.
  await assert.rejects(store.updateProfile(made.id, { deviceMemory: 0.5 }), ValidationError);
  assert.equal((await store.updateProfile(made.id, { deviceMemory: 8 })).deviceMemory, 8);
});

// --- Ready-made setups -----------------------------------------------------------------

test('each ready-made setup is one device: fixed hardware, a seed of its own', async () => {
  const presets = listPresets();
  assert.ok(presets.length >= 5);
  assert.equal(new Set(presets.map((p) => p.id)).size, presets.length);
  for (const os of ['windows', 'macos', 'linux', 'android', 'ios']) {
    assert.ok(presets.some((p) => p.os === os), `there is one for ${os}`);
  }
  const hardware = (p: Profile) => [p.os, p.screen, p.webgl, p.webgpu, p.hardwareConcurrency, p.deviceMemory, p.mobile, p.uaData.model];
  for (const preset of presets) {
    assert.ok(preset.name !== '' && preset.description !== '', preset.id);
    const a = await store.createProfile({ name: 'a' }, undefined, preset.id);
    const b = await store.createProfile({ name: 'b' }, undefined, preset.id);
    assert.equal(a.os, preset.os);
    assert.deepEqual(hardware(a), hardware(b), `${preset.id}: the same device every time`);
    assert.notEqual(a.seed, b.seed, 'but not the same noise');
    assert.ok(deviceMemoryValuesFor(a.os).includes(a.deviceMemory));
    assert.ok(a.fonts.length > 0 && a.mediaDevices !== null, 'with the lists of its system, like any new profile');
    assert.ok(Buffer.byteLength(JSON.stringify(buildKernelConfig(a))) < 16_000, 'and small enough to start');
  }
  const laptop = identityFromPreset('windows-office-laptop', KERNEL);
  assert.deepEqual([laptop.screen.width, laptop.hardwareConcurrency, laptop.deviceMemory], [1536, 8, 8]);
  assert.match(laptop.webgl.renderer, /UHD Graphics 620/);
  assert.match(laptop.userAgent, /Chrome\/158\./, 'the browser version is the kernel\'s');
});

test('a preset can be overridden, and a wrong one is refused with the list of presets', async () => {
  const profile = await store.createProfile({ name: 'Mine', timezone: 'Europe/Paris', deviceMemory: 16 }, undefined, 'windows-office-laptop');
  assert.deepEqual([profile.name, profile.timezone, profile.deviceMemory], ['Mine', 'Europe/Paris', 16]);
  await assert.rejects(store.createProfile({}, undefined, 'toaster'),
      (error: Error) => error instanceof ValidationError && /windows-laptop/.test(error.message));
  await assert.rejects(store.createProfile({ os: 'linux' }, undefined, 'pixel-8'), /android device, not linux/);
  await assert.rejects(store.createProfile({}, '00000000-0000-4000-8000-000000000000', 'pixel-8'), /not both/);
});

// --- Lists taken from the machine ------------------------------------------------------

test('a new profile carries its own fonts, voices and media devices', async () => {
  for (const os of OS_FAMILIES) {
    const profile = await store.createProfile({ os });
    assert.ok(profile.fonts.length > 0 && profile.voices.length > 0 && profile.mediaDevices !== null, os);
    // The one list it starts without is its languages.
    assert.deepEqual(borrowedLists(profile), ['languages'], os);
    assert.deepEqual(borrowedLists({ ...profile, languages: ['en-US'] }), []);
  }
});

test('what the browser reported is checked before it is kept', async () => {
  const profile = { ...(await store.createProfile({ os: 'windows' })), voices: [] };
  const voice = { name: 'Microsoft David - English (United States)', lang: 'en-US', local: true, default: true };
  assert.deepEqual(listsToKeep(profile, { languages: ['de-DE', 'de', 'de'], voices: [voice] }),
      { languages: ['de-DE', 'de'], voices: [voice] });
  // Nonsense is dropped; a list that comes back empty stays with the machine.
  assert.deepEqual(listsToKeep(profile, { languages: ['<script>', 5, 'en-US'], voices: [{ name: 7 }, { name: 'x', lang: 'y'.repeat(99) }] }),
      { languages: ['en-US'] });
  assert.deepEqual(listsToKeep(profile, { languages: [], voices: 'no' }), {});
  assert.deepEqual(listsToKeep(profile, 'garbage'), {});
  // A list the profile has is never replaced.
  assert.deepEqual(listsToKeep({ ...profile, languages: ['fr-FR'], voices: [voice] }, { languages: ['de-DE'], voices: [] }), {});
  // A very long voice list is cut to what the kernel configuration has room for.
  const many = Array.from({ length: 500 }, (_, i) => ({ ...voice, name: `Voice number ${i}` }));
  const kept = listsToKeep(profile, { languages: [], voices: many }).voices ?? [];
  assert.ok(kept.length > 10 && kept.length < 100);
});

test('the first start saves the machine\'s lists in the profile; later starts use the saved ones', async () => {
  const home = await mkdtemp(join(tmpdir(), 'proteus-lists-'));
  const local = new Store(home);
  let asked = 0;
  const voice = { name: 'Microsoft Zira - English (United States)', lang: 'en-US', local: true, default: true };
  const launcher = new Launcher(local, (_kernel, args) =>
      spawn(process.execPath, [join(here, 'stub-kernel.mjs'), ...args], { stdio: 'ignore' }), async () => true,
      async () => { asked++; return { languages: ['ar-EG', 'ar', 'en-US', 'en'], voices: [voice] }; });
  const saved = async (id: string, done: (p: Profile) => boolean): Promise<Profile> => {
    for (let i = 0; i < 50 && !done(await local.getProfile(id)); i++) await delay(50);
    return local.getProfile(id);
  };
  try {
    await mkdir(home, { recursive: true });
    await writeFile(join(home, 'kernel'), '');
    await local.updateSettings({ kernelPath: join(home, 'kernel'), exitLookupUrl: '' });

    // A new profile, and one as an early version saved it: without a voice list.
    const fresh = await local.createProfile({ os: 'windows', name: 'Fresh' });
    const old = await local.createProfile({ os: 'windows', name: 'Old', voices: [] });
    assert.ok(!('languages' in buildKernelConfig(fresh)), 'before: the kernel is told nothing, and uses the machine\'s');

    await launcher.start(fresh);
    await launcher.start(old);
    const freshNow = await saved(fresh.id, (p) => p.languages.length > 0);
    const oldNow = await saved(old.id, (p) => p.voices.length > 0);
    assert.deepEqual(freshNow.languages, ['ar-EG', 'ar', 'en-US', 'en']);
    assert.deepEqual(freshNow.voices, fresh.voices, 'a list the profile had is not replaced');
    assert.deepEqual([freshNow.seed, freshNow.fonts, freshNow.userAgent], [fresh.seed, fresh.fonts, fresh.userAgent]);
    assert.deepEqual(oldNow.voices, [voice]);
    assert.deepEqual(oldNow.languages, ['ar-EG', 'ar', 'en-US', 'en']);
    assert.equal(asked, 2);
    await launcher.stopAll();

    // From now on the profile says it itself, on this machine or any other.
    await launcher.start(freshNow);
    const config = JSON.parse(await readFile(join(local.profileDir(fresh.id), 'kernel.json'), 'utf8'));
    assert.deepEqual(config.languages, ['ar-EG', 'ar', 'en-US', 'en']);
    assert.equal(asked, 2, 'and the browser is not asked again');

    // Languages the user chose are theirs: nothing is asked or changed.
    const chosen = await local.createProfile({ os: 'windows', languages: ['de-DE', 'de'] });
    await launcher.start(chosen);
    await delay(200);
    assert.deepEqual((await local.getProfile(chosen.id)).languages, ['de-DE', 'de']);
    assert.equal(asked, 2);
  } finally {
    await launcher.stopAll();
    await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});

test('a browser that cannot be asked changes nothing', async () => {
  const home = await mkdtemp(join(tmpdir(), 'proteus-lists-'));
  const local = new Store(home);
  const launcher = new Launcher(local, (_kernel, args) =>
      spawn(process.execPath, [join(here, 'stub-kernel.mjs'), ...args], { stdio: 'ignore' }), async () => true,
      async () => { throw new Error('no such browser'); });
  try {
    await writeFile(join(home, 'kernel'), '');
    await local.updateSettings({ kernelPath: join(home, 'kernel'), exitLookupUrl: '' });
    const profile = await local.createProfile({ os: 'linux' });
    assert.equal((await launcher.start(profile)).state, 'running');
    await delay(100);
    assert.deepEqual(await local.getProfile(profile.id), profile);
  } finally {
    await launcher.stopAll();
    await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});

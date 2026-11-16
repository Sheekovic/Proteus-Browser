// The microphones, cameras and speakers a profile shows.

import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { identityFromCollected, parseCollected } from '../src/collected.ts';
import { generateIdentity } from '../src/fingerprint.ts';
import { buildKernelConfig } from '../src/kernelConfig.ts';
import { cleanMediaDevices, mediaDevicesFor } from '../src/mediaDevices.ts';
import { type OsFamily, ValidationError } from '../src/profile.ts';
import { Store } from '../src/store.ts';

const KERNEL = '158.0.8127.37';
const SYSTEMS: OsFamily[] = ['windows', 'macos', 'linux', 'android', 'ios'];

test('every system gets the devices its own browser would list', () => {
  for (const os of SYSTEMS) {
    for (let choice = 0; choice < 8; choice++) {
      const devices = mediaDevicesFor(os, (bound) => choice % bound);
      assert.deepEqual(cleanMediaDevices(devices), devices, `${os}: the generated list is valid`);
      assert.ok(devices.audioInput.length > 0 && devices.videoInput.length > 0, `${os}: a microphone and a camera`);
      const text = JSON.stringify(devices);
      if (os !== 'windows') assert.doesNotMatch(text, /Realtek|Integrated Webcam/, `${os}: no PC hardware`);
      if (os !== 'macos') assert.doesNotMatch(text, /MacBook|FaceTime/, `${os}: no Mac hardware`);
    }
  }
  const phone = mediaDevicesFor('ios');
  assert.deepEqual(phone.audioOutput, [], 'Safari lists no speakers');
  assert.equal(phone.videoInput.length, 2, 'a phone has a front and a back camera');
  assert.ok(mediaDevicesFor('android').videoInput.every((camera) => /facing (front|back)/.test(camera.label)));
  const windows = mediaDevicesFor('windows');
  assert.deepEqual(windows.audioInput.map((d) => d.id), ['default', 'communications', undefined]);
  assert.equal(windows.audioInput[0].label, `Default - ${windows.audioInput[2].label}`);
});

test('generated identities carry devices and hand them to the kernel', async () => {
  for (const os of SYSTEMS) {
    assert.ok(generateIdentity(os, KERNEL).mediaDevices !== null, os);
  }
  const dir = await mkdtemp(join(tmpdir(), 'proteus-media-'));
  try {
    const store = new Store(dir);
    const profile = await store.createProfile({ os: 'ios' });
    assert.deepEqual(buildKernelConfig(profile).mediaDevices, profile.mediaDevices);
    assert.deepEqual(profile.mediaDevices?.audioOutput, []);

    // null means "this machine's devices": nothing is sent, and the kernel changes nothing.
    const own = await store.updateProfile(profile.id, { mediaDevices: null });
    assert.ok(!('mediaDevices' in buildKernelConfig(own)));

    const custom = { audioInput: [{ label: 'USB Microphone' }], videoInput: [], audioOutput: [] };
    assert.deepEqual((await store.updateProfile(profile.id, { mediaDevices: custom })).mediaDevices, custom);
    await assert.rejects(store.updateProfile(profile.id, { mediaDevices: { audioInput: [{ label: '' }] } as never }), ValidationError);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('a malformed device list is refused', () => {
  assert.equal(cleanMediaDevices(null), null);
  assert.deepEqual(cleanMediaDevices({}), { audioInput: [], videoInput: [], audioOutput: [] });
  assert.deepEqual(cleanMediaDevices({ videoInput: [{ label: 'Camera' }] }),
                   { audioInput: [], videoInput: [{ label: 'Camera' }], audioOutput: [] });
  for (const bad of [
    'devices', [], { cameras: [] }, { videoInput: 'one' }, { videoInput: ['Camera'] }, { videoInput: [{ label: 5 }] },
    { videoInput: [{ label: 'x'.repeat(201) }] }, { videoInput: [{ label: 'Camera', id: 'abc' }] },
    { videoInput: [{ label: 'Camera', path: '/dev/video0' }] },
    { audioInput: [{ id: 'default', label: 'A' }, { id: 'default', label: 'B' }] },
    { videoInput: Array.from({ length: 17 }, () => ({ label: 'Camera' })) },
  ]) {
    assert.throws(() => cleanMediaDevices(bad), ValidationError, JSON.stringify(bad).slice(0, 60));
  }
});

test('a device read without a camera stays without one', () => {
  const reading = (mediaKinds?: string[]): Record<string, unknown> => ({
    format: 'proteus-fingerprint', version: 1,
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
    platform: 'Win32', vendor: 'Google Inc.', uaData: null, hardwareConcurrency: 8, deviceMemory: 8, maxTouchPoints: 0,
    screen: { width: 1920, height: 1080, availWidth: 1920, availHeight: 1040, colorDepth: 24 },
    devicePixelRatio: 1, innerWidth: 1900, innerHeight: 900, webgl: null, webgpu: null, voices: [], fonts: ['Arial'],
    ...(mediaKinds ? { mediaKinds } : {}),
  });
  const old = identityFromCollected(parseCollected(reading()), KERNEL);
  assert.ok(old.mediaDevices && old.mediaDevices.videoInput.length === 1, 'an older reading gets the usual devices');

  const parsed = parseCollected(reading(['audiooutput', 'audioinput', 'hologram']));
  assert.deepEqual(parsed.mediaKinds, ['audioinput', 'audiooutput'], 'only known kinds are kept');
  const desktop = identityFromCollected(parsed, KERNEL);
  assert.deepEqual(desktop.mediaDevices?.videoInput, []);
  assert.equal(desktop.mediaDevices?.audioInput.length, 3);
});

test('the battery and connection fit the device, and are never this machine\'s', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'proteus-battery-'));
  try {
    const store = new Store(dir);
    const hour = 3600_000;
    const start = 6 * hour * 80_000;  // The beginning of a six-hour period.

    const desktop = buildKernelConfig(await store.createProfile({ os: 'windows' }), start);
    assert.deepEqual(desktop.battery, { charging: true, level: 1 }, 'a computer: on its charger and full');
    assert.ok(!('connection' in desktop), 'desktop Chrome does not say what kind of connection it has');

    const phone = await store.createProfile({ os: 'android' });
    const first = buildKernelConfig(phone, start + hour) as Record<string, any>;
    assert.deepEqual(first.connection, { type: 'wifi' });
    assert.equal(first.battery.charging, false);
    assert.ok(first.battery.level >= 0.7 && first.battery.level <= 1);
    assert.ok(first.battery.drainPerHour >= 0.04 && first.battery.drainPerHour <= 0.09);
    assert.deepEqual(buildKernelConfig(phone, start + 5 * hour).battery, first.battery,
                     'restarting the browser does not recharge the phone');
    assert.equal(first.battery.at, start / 1000);
    const levels = new Set(Array.from({ length: 12 }, (_, i) =>
        (buildKernelConfig(phone, start + i * 6 * hour) as Record<string, any>).battery.level));
    assert.ok(levels.size > 3, 'another part of the day, another charge');

    const iphone = buildKernelConfig(await store.createProfile({ os: 'ios' }), start);
    assert.ok(!('battery' in iphone) && !('connection' in iphone), 'Safari has neither interface');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

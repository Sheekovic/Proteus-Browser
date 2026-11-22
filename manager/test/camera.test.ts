// A camera picture from a file: the setting, the kernel arguments, and the start.

import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';

import { buildKernelArgs } from '../src/kernelConfig.ts';
import { Launcher, silentWav } from '../src/launcher.ts';
import { ValidationError } from '../src/profile.ts';
import { Store } from '../src/store.ts';

let dir: string;
let store: Store;
before(async () => {
  dir = await mkdtemp(join(tmpdir(), 'proteus-camera-'));
  store = new Store(dir);
});
after(async () => { await rm(dir, { recursive: true, force: true }); });

test('a profile uses the camera of the machine unless it names a video file', async () => {
  const profile = await store.createProfile({ os: 'windows' });
  assert.equal(profile.cameraFile, '');
  const plain = buildKernelArgs(profile, { userDataDir: 'u', configFile: 'c' }, []);
  assert.ok(!plain.some((arg) => arg.includes('fake')), 'nothing stands in for its devices');

  const video = join(dir, 'room.y4m');
  const withFile = await store.updateProfile(profile.id, { cameraFile: video });
  const args = buildKernelArgs(withFile, { userDataDir: 'u', configFile: 'c', silenceFile: 's.wav' }, []);
  assert.ok(args.includes('--use-fake-device-for-media-stream'));
  assert.ok(args.includes(`--use-file-for-fake-video-capture=${video}`));
  assert.ok(args.includes('--use-file-for-fake-audio-capture=s.wav'), 'the microphone is silent, it does not beep');
  // Nothing answers the permission question for the user.
  assert.ok(!args.includes('--use-fake-ui-for-media-stream'));

  assert.equal((await store.duplicateProfile(profile.id)).cameraFile, video, 'a copy keeps it');
  for (const bad of ['room.mp4', 'room', 'http://example.com/room.y4m.exe']) {
    await assert.rejects(store.updateProfile(profile.id, { cameraFile: bad }), ValidationError, bad);
  }
  assert.equal((await store.updateProfile(profile.id, { cameraFile: 'C:\videos\Room.MJPEG' })).cameraFile, 'C:\videos\Room.MJPEG');
});

test('the silence the microphone plays is a sound file of one second', () => {
  const wav = silentWav();
  assert.equal(wav.subarray(0, 4).toString('ascii') + wav.subarray(8, 12).toString('ascii'), 'RIFFWAVE');
  assert.equal(wav.readUInt32LE(4), wav.length - 8);
  assert.equal(wav.readUInt32LE(24), 48_000);
  assert.equal(wav.readUInt32LE(40), wav.length - 44);
  assert.ok(wav.subarray(44).every((byte) => byte === 0));
});

test('a profile whose video file is not there does not start', async () => {
  const kernel = join(dir, 'kernel.exe');
  await writeFile(kernel, '');
  await store.updateSettings({ kernelPath: kernel, exitLookupUrl: '' });
  const profile = await store.createProfile({ os: 'windows', cameraFile: join(dir, 'missing.y4m') });
  const launcher = new Launcher(store);
  await assert.rejects(launcher.start(profile), /camera picture .* is not there/);
});

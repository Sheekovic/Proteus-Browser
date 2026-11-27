// A camera picture from a file: the setting, the kernel arguments, and the start.

import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';

import { buildKernelArgs } from '../src/kernelConfig.ts';
import { Launcher, silentWav } from '../src/launcher.ts';
import { cameraSource, ValidationError } from '../src/profile.ts';
import { COVERED_HEIGHT, COVERED_WIDTH, coveredLensVideo } from '../src/coveredLens.ts';
import { Store } from '../src/store.ts';

let dir: string;
let store: Store;
before(async () => {
  dir = await mkdtemp(join(tmpdir(), 'proteus-camera-'));
  store = new Store(dir);
});
// A browser that was just stopped may hold its folder a moment longer on Windows.
after(async () => { await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); });

test('a profile shows a covered lens unless it names a video file or asks for the machine', async () => {
  const profile = await store.createProfile({ os: 'windows' });
  assert.equal(profile.cameraFile, '');
  assert.notEqual(profile.mediaDevices, null, 'a new profile has devices of its own');
  assert.equal(cameraSource(profile), 'covered');
  const covered = buildKernelArgs(profile, { userDataDir: 'u', configFile: 'c', silenceFile: 's.wav', coveredLensFile: 'lens.y4m' }, []);
  assert.ok(covered.includes('--use-fake-device-for-media-stream'));
  assert.ok(covered.includes('--use-file-for-fake-video-capture=lens.y4m'));
  assert.ok(covered.includes('--use-file-for-fake-audio-capture=s.wav'));
  assert.ok(!covered.includes('--use-fake-ui-for-media-stream'), 'the user is still asked');

  // The machine's own, when asked for, and for a profile whose devices are the machine's.
  const machine = await store.updateProfile(profile.id, { cameraFile: 'machine' });
  assert.equal(cameraSource(machine), 'machine');
  const plain = buildKernelArgs(machine, { userDataDir: 'u', configFile: 'c' }, []);
  assert.ok(!plain.some((arg) => arg.includes('fake')), 'nothing stands in for its devices');
  assert.equal(cameraSource({ cameraFile: '', mediaDevices: null }), 'machine');
  assert.equal(cameraSource({ cameraFile: 'room.y4m', mediaDevices: null }), 'file');

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

test('the covered lens is a dark video with a grain of its own for each profile', () => {
  const video = coveredLensVideo('12345');
  const header = `YUV4MPEG2 W${COVERED_WIDTH} H${COVERED_HEIGHT} F30:1 Ip A1:1 C420jpeg\n`;
  assert.equal(video.subarray(0, header.length).toString('ascii'), header);
  const frame = 6 + COVERED_WIDTH * COVERED_HEIGHT * 1.5;
  assert.equal((video.length - header.length) % frame, 0, 'whole frames');
  assert.ok((video.length - header.length) / frame >= 2, 'more than one frame: the grain moves');
  assert.equal(video.subarray(header.length, header.length + 6).toString('ascii'), 'FRAME\n');
  const luma = video.subarray(header.length + 6, header.length + 6 + COVERED_WIDTH * COVERED_HEIGHT);
  let sum = 0, highest = 0;
  const seen = new Set<number>();
  for (const value of luma) { sum += value; highest = Math.max(highest, value); seen.add(value); }
  assert.ok(sum / luma.length >= 16 && sum / luma.length < 22, `dark: ${sum / luma.length}`);
  assert.ok(highest <= 48, `no bright pixel: ${highest}`);
  assert.ok(seen.size >= 6, 'grain, not one flat colour');
  const chroma = video.subarray(header.length + 6 + luma.length, header.length + frame);
  assert.ok(chroma.every((value) => value >= 127 && value <= 129), 'no colour');
  assert.ok(coveredLensVideo('12345').equals(video), 'the same for the same seed');
  assert.ok(!coveredLensVideo('12346').equals(video), 'another for another');
});

test('a profile whose video file is not there does not start', async () => {
  const kernel = join(dir, 'kernel.exe');
  await writeFile(kernel, '');
  await store.updateSettings({ kernelPath: kernel, exitLookupUrl: '' });
  const profile = await store.createProfile({ os: 'windows', cameraFile: join(dir, 'missing.y4m') });
  const launcher = new Launcher(store);
  await assert.rejects(launcher.start(profile), /camera picture .* is not there/);
});

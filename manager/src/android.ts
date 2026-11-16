// Identities for phone profiles: Chrome on Android.
//
// A phone identity is one device model with the properties that model really has:
// its screen in CSS pixels, its pixel ratio, its GPU, its core count and memory. The
// figures are the manufacturers' published specifications; the list is short on
// purpose, since every entry has to be right as a whole.

import type { GeneratedIdentity, Rng } from './fingerprint.ts';
import { randomSeed } from './fingerprint.ts';
import { mediaDevicesFor } from './mediaDevices.ts';
import { voicesFor } from './voices.ts';

interface Device {
  /** Model name as the client hints report it. */
  model: string;
  /** Screen in CSS pixels and device pixels per CSS pixel. */
  width: number;
  height: number;
  pixelRatio: number;
  /** GPU as ANGLE names it on Android, and its WebGPU architecture family. */
  gpu: string;
  gpuFamily: string;
  cores: number;
  /** navigator.deviceMemory, which Chrome caps at 8. */
  memory: number;
}

// All of these use ARM Mali GPUs, whose WebGPU family names (Bifrost, Valhall) are
// ARM's own architecture names.
const DEVICES: readonly Device[] = [
  { model: 'Pixel 8', width: 412, height: 915, pixelRatio: 2.625, gpu: 'Mali-G715', gpuFamily: 'valhall', cores: 9, memory: 8 },
  { model: 'Pixel 7', width: 412, height: 915, pixelRatio: 2.625, gpu: 'Mali-G710', gpuFamily: 'valhall', cores: 8, memory: 8 },
  { model: 'Pixel 6a', width: 412, height: 915, pixelRatio: 2.625, gpu: 'Mali-G78', gpuFamily: 'valhall', cores: 8, memory: 4 },
  { model: 'SM-A346B', width: 360, height: 780, pixelRatio: 3, gpu: 'Mali-G68 MC4', gpuFamily: 'valhall', cores: 8, memory: 8 },
  { model: 'SM-A155F', width: 360, height: 780, pixelRatio: 3, gpu: 'Mali-G57 MC2', gpuFamily: 'valhall', cores: 8, memory: 4 },
  { model: 'SM-A145F', width: 360, height: 780, pixelRatio: 3, gpu: 'Mali-G52 MC2', gpuFamily: 'bifrost', cores: 8, memory: 4 },
];

const ANDROID_VERSIONS = ['13.0.0', '14.0.0', '15.0.0'];

/**
 * The font families Android itself ships and a page can find by name. A phone profile
 * claims these and hides the machine's own: a "phone" on which Segoe UI or Calibri is
 * installed is a desktop. The machine does not have them, so each is drawn with a
 * stand-in of its kind (fontSubstitutes.ts); a page finds the name, though careful
 * measurement of the glyphs can still tell the stand-in from the real font.
 */
export const ANDROID_FONTS: readonly string[] = [
  'Carrois Gothic SC', 'Coming Soon', 'Cutive Mono', 'Dancing Script', 'Droid Sans Mono', 'Noto Color Emoji',
  'Noto Sans', 'Noto Sans CJK JP', 'Noto Serif', 'Roboto',
  // Names Android does not have as fonts but answers to: its font configuration maps
  // them onto its own sans-serif, serif and monospace faces, so a page finds them.
  'Arial', 'Helvetica', 'Tahoma', 'Verdana',
  'Baskerville', 'Georgia', 'Goudy', 'Palatino', 'Times', 'Times New Roman',
  'Courier', 'Courier New', 'Monaco',
];

/**
 * Height in CSS pixels that Android's status bar, Chrome's toolbar and the system
 * navigation bar take from the screen, leaving the rest to the page.
 */
const SYSTEM_BARS_HEIGHT = 130;

/** A fresh Chrome-on-Android identity matching kernel version `kernelVersion`. */
export function generateAndroidIdentity(kernelVersion: string, rng: Rng): GeneratedIdentity {
  const device = DEVICES[rng(DEVICES.length)];
  const major = kernelVersion.split('.')[0];
  return {
    seed: randomSeed(),
    os: 'android',
    // Chrome on Android reports this fixed device part whatever the phone is; the
    // model is only available through client hints.
    userAgent: `Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) ` +
               `Chrome/${major}.0.0.0 Mobile Safari/537.36`,
    platform: 'Linux armv81',
    uaData: {
      brand: 'Google Chrome',
      brands: [],
      fullVersionList: [],
      fullVersion: kernelVersion,
      platform: 'Android',
      platformVersion: ANDROID_VERSIONS[rng(ANDROID_VERSIONS.length)],
      architecture: '',
      bitness: '',
      model: device.model,
      mobile: true,
      wow64: false,
    },
    hardwareConcurrency: device.cores,
    deviceMemory: device.memory,
    screen: { width: device.width, height: device.height, availWidth: device.width, availHeight: device.height, colorDepth: 24 },
    webgl: { vendor: 'Google Inc. (ARM)', renderer: `ANGLE (ARM, ${device.gpu}, OpenGL ES 3.2)` },
    webglCaps: null,
    webgpu: { vendor: 'arm', architecture: device.gpuFamily },
    noise: { canvas: true, audio: true },
    fonts: [...ANDROID_FONTS],
    voices: voicesFor('android'),
    mediaDevices: mediaDevicesFor('android', rng),
    mobile: {
      viewWidth: device.width,
      viewHeight: device.height - SYSTEM_BARS_HEIGHT,
      deviceScaleFactor: device.pixelRatio,
      maxTouchPoints: 5,
    },
  };
}

// The microphones, cameras and speakers a device reports.
//
// navigator.mediaDevices.enumerateDevices() tells every page which kinds of device a
// machine has, and tells a page that was allowed to use one their names. The names
// are the operating system's and the hardware's: a "phone" that lists a Realtek sound
// card, or a Mac with an "Integrated Webcam", has given itself away. These are the
// lists default installations show, written the way each system's browser writes them.

import { randomBytes } from 'node:crypto';

import type { OsFamily } from './profile.ts';
import { ValidationError } from './profile.ts';

export interface MediaDevice {
  label: string;
  /**
   * "default" or "communications" for the entry an operating system adds for the
   * device it would choose itself; absent for a device.
   */
  id?: 'default' | 'communications';
}

export interface MediaDevices {
  audioInput: MediaDevice[];
  videoInput: MediaDevice[];
  audioOutput: MediaDevice[];
}

type Rng = (bound: number) => number;

const cryptoRng: Rng = (bound) => randomBytes(4).readUInt32BE(0) % bound;

const pick = <T>(rng: Rng, items: readonly T[]): T => items[rng(items.length)];

/** Chrome on Windows lists the system's chosen devices first, then each device. */
function windowsAudio(name: string): MediaDevice[] {
  return [
    { id: 'default', label: `Default - ${name}` },
    { id: 'communications', label: `Communications - ${name}` },
    { label: name },
  ];
}

// A sound chip and the laptop cameras sold with it. The numbers after a camera's name
// are its USB vendor and product ids, as Chrome prints them.
const WINDOWS_AUDIO = [
  { microphone: 'Microphone (Realtek(R) Audio)', speakers: 'Speakers (Realtek(R) Audio)' },
  { microphone: 'Microphone Array (Realtek(R) Audio)', speakers: 'Speakers (Realtek(R) Audio)' },
  { microphone: 'Microphone (Realtek High Definition Audio)', speakers: 'Speakers (Realtek High Definition Audio)' },
  { microphone: 'Microphone Array (Intel® Smart Sound Technology for Digital Microphones)', speakers: 'Speakers (Realtek(R) Audio)' },
] as const;
const WINDOWS_CAMERAS = [
  'Integrated Webcam (0c45:6730)', 'Integrated Camera (5986:2113)', 'HD Webcam (04f2:b6dd)',
  'HP TrueVision HD Camera (0408:5365)', 'USB2.0 HD UVC WebCam (13d3:56a2)', 'Integrated Camera (04f2:b6cb)',
] as const;

const MACS = [
  { name: 'MacBook Pro', camera: 'FaceTime HD Camera (3A71:F4B5)' },
  { name: 'MacBook Air', camera: 'FaceTime HD Camera (5B00:3AA6)' },
] as const;

const LINUX_CAMERAS = [
  'Integrated Camera: Integrated C (04f2:b6cb)', 'HD WebCam: HD WebCam (04f2:b5d6)',
  'Integrated_Webcam_HD: Integrate (0c45:6717)',
] as const;

/** The devices a default installation of `os` shows, in the order its browser lists them. */
export function mediaDevicesFor(os: OsFamily, rng: Rng = cryptoRng): MediaDevices {
  switch (os) {
    case 'windows': {
      const audio = pick(rng, WINDOWS_AUDIO);
      return {
        audioInput: windowsAudio(audio.microphone),
        videoInput: [{ label: pick(rng, WINDOWS_CAMERAS) }],
        audioOutput: windowsAudio(audio.speakers),
      };
    }
    case 'macos': {
      const mac = pick(rng, MACS);
      return {
        audioInput: [{ id: 'default', label: `Default - ${mac.name} Microphone (Built-in)` },
                     { label: `${mac.name} Microphone (Built-in)` }],
        videoInput: [{ label: mac.camera }],
        audioOutput: [{ id: 'default', label: `Default - ${mac.name} Speakers (Built-in)` },
                      { label: `${mac.name} Speakers (Built-in)` }],
      };
    }
    case 'linux':
      return {
        audioInput: [{ id: 'default', label: 'Default' }, { label: 'Built-in Audio Analog Stereo' }],
        videoInput: [{ label: pick(rng, LINUX_CAMERAS) }],
        audioOutput: [{ id: 'default', label: 'Default' }, { label: 'Built-in Audio Analog Stereo' }],
      };
    case 'android':
      // Chrome on Android names audio routes, not hardware, and numbers the cameras.
      return {
        audioInput: [{ id: 'default', label: 'Default' }, { label: 'Speakerphone' }, { label: 'Headset earpiece' }],
        videoInput: [{ label: 'camera2 1, facing front' }, { label: 'camera2 0, facing back' }],
        audioOutput: [{ id: 'default', label: 'Default' }],
      };
    case 'ios':
      // Safari lists no speakers at all.
      return {
        audioInput: [{ label: 'iPhone Microphone' }],
        videoInput: [{ label: 'Front Camera' }, { label: 'Back Camera' }],
        audioOutput: [],
      };
  }
}

const KINDS = ['audioInput', 'videoInput', 'audioOutput'] as const;
const MAX_PER_KIND = 16;

/**
 * Checks a media device list from outside and returns it in the stored form.
 * null means "this machine's devices".
 */
export function cleanMediaDevices(value: unknown): MediaDevices | null {
  if (value === null || value === undefined) return null;
  const fail = (message: string): never => { throw new ValidationError(`mediaDevices: ${message}`); };
  if (typeof value !== 'object' || Array.isArray(value)) fail('must be an object or null');
  const raw = value as Record<string, unknown>;
  for (const key of Object.keys(raw)) {
    if (!(KINDS as readonly string[]).includes(key)) fail(`unknown kind "${key}"`);
  }
  const result: MediaDevices = { audioInput: [], videoInput: [], audioOutput: [] };
  for (const kind of KINDS) {
    const list = raw[kind] ?? [];
    if (!Array.isArray(list) || list.length > MAX_PER_KIND) fail(`${kind} must be a list of at most ${MAX_PER_KIND} devices`);
    for (const entry of list as unknown[]) {
      if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) fail(`${kind} entries must be {label, id?}`);
      const { label, id, ...rest } = entry as Record<string, unknown>;
      if (Object.keys(rest).length > 0) fail(`${kind} entries must be {label, id?}`);
      if (typeof label !== 'string' || label.trim() === '' || label.length > 200) fail(`${kind} labels must be 1 to 200 characters`);
      if (id !== undefined && id !== 'default' && id !== 'communications') fail(`${kind} ids may only be "default" or "communications"`);
      if (id !== undefined && result[kind].some((device) => device.id === id)) fail(`${kind} has more than one "${id}" entry`);
      result[kind].push(id === undefined ? { label: label as string } : { id, label: label as string });
    }
  }
  return result;
}

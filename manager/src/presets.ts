// Ready-made setups: ordinary devices to choose from when making a profile, instead of
// leaving every part to chance.
//
// A preset fixes what makes a device that device - its screen, graphics card,
// processor and memory - with parts that are sold together. Everything else is made
// as for any new profile: a noise seed of its own, and the fonts, voices and media
// devices of the system. Two profiles from one preset are therefore two devices of
// the same model, not the same device.
//
// These are compositions of widely sold configurations, written by hand. They are not
// readings of real devices; those are made with the collector page (collected.ts).

import { generateAndroidIdentity } from './android.ts';
import {
  cryptoRng, d3d11, type DesktopChoice, type DesktopOs, type GeneratedIdentity, generateDesktopIdentity, metal, openGl, type Rng,
} from './fingerprint.ts';
import { generateIosIdentity } from './ios.ts';
import { type OsFamily, ValidationError } from './profile.ts';

interface PresetBase {
  /** What a caller passes as `preset`. */
  id: string;
  name: string;
  /** One line on what kind of device this is. */
  description: string;
}

type Preset = PresetBase & (
  | { os: DesktopOs; device: Required<DesktopChoice> }
  /** A phone by its model name (android.ts). */
  | { os: 'android'; model: string }
  /** An iPhone by its screen in points (ios.ts). */
  | { os: 'ios'; screen: readonly [number, number] });

const PRESETS: readonly Preset[] = [
  {
    id: 'windows-office-laptop', name: 'Windows office laptop', os: 'windows',
    description: 'A 15-inch business laptop: full HD at 125% scaling, Intel graphics, 8 GB.',
    device: { screen: [1536, 864, 48, 1.25], gpu: d3d11('Intel', 'Intel(R) UHD Graphics 620 (0x00005917)', 'gen-9'), cores: 8, memory: 8 },
  },
  {
    id: 'windows-laptop', name: 'Windows laptop', os: 'windows',
    description: 'A recent thin laptop: full HD, Intel Iris Xe graphics, 16 GB.',
    device: { screen: [1920, 1080, 48], gpu: d3d11('Intel', 'Intel(R) Iris(R) Xe Graphics (0x00009A49)', 'gen-12lp'), cores: 12, memory: 16 },
  },
  {
    id: 'windows-desktop', name: 'Windows desktop', os: 'windows',
    description: 'A home desktop with a full HD monitor and a mid-range NVIDIA card, 16 GB.',
    device: { screen: [1920, 1080, 40], gpu: d3d11('NVIDIA', 'NVIDIA GeForce GTX 1660 SUPER (0x000021C4)', 'turing'), cores: 12, memory: 16 },
  },
  {
    id: 'windows-gaming-desktop', name: 'Windows gaming desktop', os: 'windows',
    description: 'A gaming desktop with a 1440p monitor and an RTX 4060, 32 GB.',
    device: { screen: [2560, 1440, 48], gpu: d3d11('NVIDIA', 'NVIDIA GeForce RTX 4060 (0x00002882)', 'lovelace'), cores: 16, memory: 32 },
  },
  {
    id: 'macbook-air', name: 'MacBook Air', os: 'macos',
    description: 'A 13-inch MacBook Air with the M1 chip, 8 GB.',
    device: { screen: [1440, 900, 25, 2, 30], gpu: metal('Apple M1'), cores: 8, memory: 8 },
  },
  {
    id: 'macbook-pro-14', name: 'MacBook Pro 14"', os: 'macos',
    description: 'A 14-inch MacBook Pro with the M3 Pro chip, 18 GB (which a browser reports as 16).',
    device: { screen: [1512, 982, 38, 2, 30], gpu: metal('Apple M3 Pro'), cores: 12, memory: 16 },
  },
  {
    id: 'linux-desktop', name: 'Linux desktop', os: 'linux',
    description: 'An Ubuntu desktop with a full HD monitor and Intel graphics, 16 GB.',
    device: { screen: [1920, 1080, 27], gpu: openGl('Intel', 'Mesa Intel(R) UHD Graphics 630 (CFL GT2), OpenGL 4.6', 'intel', 'gen-9'), cores: 8, memory: 16 },
  },
  { id: 'pixel-8', name: 'Google Pixel 8', os: 'android', model: 'Pixel 8', description: 'Chrome on a Pixel 8.' },
  { id: 'galaxy-a34', name: 'Samsung Galaxy A34', os: 'android', model: 'SM-A346B', description: 'Chrome on a Galaxy A34 5G.' },
  { id: 'iphone-15', name: 'iPhone 15', os: 'ios', screen: [393, 852], description: 'Safari on an iPhone 15 or 16.' },
];

/** A preset as lists show it. */
export interface PresetSummary {
  id: string;
  name: string;
  os: OsFamily;
  description: string;
}

export function listPresets(): PresetSummary[] {
  return PRESETS.map(({ id, name, os, description }) => ({ id, name, os, description }));
}

/** The system of preset `id`. Throws ValidationError, naming the presets there are, when there is none. */
export function presetOs(id: string): OsFamily {
  return find(id).os;
}

function find(id: string): Preset {
  const preset = PRESETS.find((candidate) => candidate.id === id);
  if (!preset) throw new ValidationError(`there is no preset "${id}"; there are ${PRESETS.map((p) => p.id).join(', ')}`);
  return preset;
}

/** A fresh identity of the device preset `id` describes, for kernel version `kernelVersion`. */
export function identityFromPreset(id: string, kernelVersion: string, rng: Rng = cryptoRng): GeneratedIdentity {
  const preset = find(id);
  if (preset.os === 'android') return generateAndroidIdentity(kernelVersion, rng, preset.model);
  if (preset.os === 'ios') return generateIosIdentity(rng, preset.screen);
  return generateDesktopIdentity(preset.os, kernelVersion, rng, preset.device);
}

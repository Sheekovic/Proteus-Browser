// Generates a coherent browser identity for a new profile.
//
// "Coherent" means the parts agree with each other the way they do on a real
// machine: a Windows user agent comes with Windows client hints, a Direct3D GPU
// string and a common Windows screen size. The value pools below are ordinary,
// widely seen desktop configurations; nothing here is copied from another product.

import { randomBytes } from 'node:crypto';
import type { OsFamily, Profile, ScreenInfo, UaData } from './profile.ts';

/** Returns a uniformly distributed integer in [0, bound). */
export type Rng = (bound: number) => number;

const cryptoRng: Rng = (bound) => randomBytes(4).readUInt32BE(0) % bound;

function pick<T>(rng: Rng, items: readonly T[]): T {
  return items[rng(items.length)];
}

interface Gpu {
  vendor: string;
  renderer: string;
}

// [width, height, taskbar/dock height]
const SCREENS: Record<OsFamily, readonly (readonly [number, number, number])[]> = {
  windows: [[1920, 1080, 48], [1920, 1080, 40], [1366, 768, 40], [1536, 864, 48], [2560, 1440, 48], [1600, 900, 40]],
  linux: [[1920, 1080, 27], [1920, 1080, 0], [2560, 1440, 27], [1366, 768, 27], [1680, 1050, 27]],
  macos: [[1440, 900, 25], [1512, 982, 38], [1728, 1117, 38], [1680, 1050, 25], [2560, 1440, 25]],
};

const d3d11 = (vendor: string, device: string): Gpu => ({
  vendor: `Google Inc. (${vendor})`,
  renderer: `ANGLE (${vendor}, ${device} Direct3D11 vs_5_0 ps_5_0, D3D11)`,
});

const GPUS: Record<OsFamily, readonly Gpu[]> = {
  windows: [
    d3d11('Intel', 'Intel(R) UHD Graphics 630 (0x00003E9B)'),
    d3d11('Intel', 'Intel(R) UHD Graphics 620 (0x00005917)'),
    d3d11('Intel', 'Intel(R) Iris(R) Xe Graphics (0x00009A49)'),
    d3d11('NVIDIA', 'NVIDIA GeForce GTX 1650 (0x00001F82)'),
    d3d11('NVIDIA', 'NVIDIA GeForce GTX 1660 SUPER (0x000021C4)'),
    d3d11('NVIDIA', 'NVIDIA GeForce RTX 3060 (0x00002503)'),
    d3d11('NVIDIA', 'NVIDIA GeForce RTX 4060 (0x00002882)'),
    d3d11('AMD', 'AMD Radeon RX 580 Series (0x000067DF)'),
    d3d11('AMD', 'AMD Radeon(TM) Graphics (0x00001636)'),
  ],
  linux: [
    {
      vendor: 'Google Inc. (Intel)',
      renderer: 'ANGLE (Intel, Mesa Intel(R) UHD Graphics 630 (CFL GT2), OpenGL 4.6)',
    },
    {
      vendor: 'Google Inc. (Intel)',
      renderer: 'ANGLE (Intel, Mesa Intel(R) Xe Graphics (TGL GT2), OpenGL 4.6)',
    },
    {
      vendor: 'Google Inc. (AMD)',
      renderer: 'ANGLE (AMD, AMD Radeon RX 580 Series (radeonsi, polaris10, LLVM 17.0.6, DRM 3.57), OpenGL 4.6)',
    },
    {
      vendor: 'Google Inc. (NVIDIA Corporation)',
      renderer: 'ANGLE (NVIDIA Corporation, NVIDIA GeForce GTX 1650/PCIe/SSE2, OpenGL 4.5.0)',
    },
  ],
  macos: [
    { vendor: 'Google Inc. (Apple)', renderer: 'ANGLE (Apple, ANGLE Metal Renderer: Apple M1, Unspecified Version)' },
    { vendor: 'Google Inc. (Apple)', renderer: 'ANGLE (Apple, ANGLE Metal Renderer: Apple M2, Unspecified Version)' },
    { vendor: 'Google Inc. (Apple)', renderer: 'ANGLE (Apple, ANGLE Metal Renderer: Apple M3 Pro, Unspecified Version)' },
  ],
};

const CORES: Record<OsFamily, readonly number[]> = {
  windows: [4, 6, 8, 8, 12, 16],
  linux: [4, 8, 8, 12, 16],
  macos: [8, 8, 10, 12],
};
const MEMORY: Record<OsFamily, readonly number[]> = {
  windows: [8, 8, 16, 16, 32],
  linux: [8, 16, 16, 32],
  macos: [8, 16, 16, 32],
};

// Font families that ship with a default installation of each system. A profile
// exposes these and hides anything else found on the machine (fonts added by office
// suites, design tools and so on are a strong, stable identifier).
const FONTS: Record<OsFamily, readonly string[]> = {
  windows: [
    'Arial', 'Arial Black', 'Bahnschrift', 'Calibri', 'Cambria', 'Cambria Math', 'Candara',
    'Comic Sans MS', 'Consolas', 'Constantia', 'Corbel', 'Courier New', 'Ebrima',
    'Franklin Gothic Medium', 'Gabriola', 'Gadugi', 'Georgia', 'Impact', 'Ink Free',
    'Javanese Text', 'Leelawadee UI', 'Lucida Console', 'Lucida Sans Unicode', 'Malgun Gothic',
    'Marlett', 'Microsoft Himalaya', 'Microsoft JhengHei', 'Microsoft New Tai Lue',
    'Microsoft PhagsPa', 'Microsoft Sans Serif', 'Microsoft Tai Le', 'Microsoft YaHei',
    'Microsoft Yi Baiti', 'MingLiU-ExtB', 'Mongolian Baiti', 'MS Gothic', 'MV Boli',
    'Myanmar Text', 'Nirmala UI', 'Palatino Linotype', 'Segoe MDL2 Assets', 'Segoe Print',
    'Segoe Script', 'Segoe UI', 'Segoe UI Emoji', 'Segoe UI Historic', 'Segoe UI Symbol',
    'SimSun', 'Sitka', 'Sylfaen', 'Symbol', 'Tahoma', 'Times New Roman', 'Trebuchet MS',
    'Verdana', 'Webdings', 'Wingdings', 'Yu Gothic',
  ],
  macos: [
    'American Typewriter', 'Andale Mono', 'Arial', 'Arial Black', 'Arial Narrow',
    'Arial Rounded MT Bold', 'Arial Unicode MS', 'Avenir', 'Avenir Next', 'Avenir Next Condensed',
    'Baskerville', 'Big Caslon', 'Bodoni 72', 'Bradley Hand', 'Brush Script MT', 'Chalkboard',
    'Chalkboard SE', 'Chalkduster', 'Charter', 'Cochin', 'Comic Sans MS', 'Copperplate',
    'Courier', 'Courier New', 'Didot', 'Futura', 'Geneva', 'Georgia', 'Gill Sans', 'Helvetica',
    'Helvetica Neue', 'Herculanum', 'Hoefler Text', 'Impact', 'Lucida Grande', 'Luminari',
    'Marker Felt', 'Menlo', 'Monaco', 'Noteworthy', 'Optima', 'Palatino', 'Papyrus', 'Phosphate',
    'Rockwell', 'Savoye LET', 'SignPainter', 'Skia', 'Snell Roundhand', 'Tahoma', 'Times',
    'Times New Roman', 'Trattatello', 'Trebuchet MS', 'Verdana', 'Zapfino',
  ],
  linux: [
    'DejaVu Sans', 'DejaVu Sans Mono', 'DejaVu Serif', 'Liberation Mono', 'Liberation Sans',
    'Liberation Sans Narrow', 'Liberation Serif', 'Noto Color Emoji', 'Noto Mono',
    'Noto Sans CJK JP', 'Noto Sans Mono', 'Noto Serif CJK JP', 'Ubuntu', 'Ubuntu Condensed',
    'Ubuntu Mono', 'C059', 'D050000L', 'Nimbus Mono PS', 'Nimbus Roman', 'Nimbus Sans',
    'Nimbus Sans Narrow', 'P052', 'Standard Symbols PS', 'URW Bookman', 'URW Gothic', 'Z003',
  ],
};

interface OsIdentity {
  uaPlatformToken: string;
  navigatorPlatform: string;
  chPlatform: string;
  chPlatformVersions: readonly string[];
  architecture: string;
}

const OS_IDENTITY: Record<OsFamily, OsIdentity> = {
  windows: {
    uaPlatformToken: 'Windows NT 10.0; Win64; x64',
    navigatorPlatform: 'Win32',
    chPlatform: 'Windows',
    // Windows 10 reports 10.0.0; Windows 11 reports 13.0.0 and above.
    chPlatformVersions: ['10.0.0', '15.0.0', '19.0.0'],
    architecture: 'x86',
  },
  linux: {
    uaPlatformToken: 'X11; Linux x86_64',
    navigatorPlatform: 'Linux x86_64',
    chPlatform: 'Linux',
    chPlatformVersions: ['6.8.0', '6.11.0', '6.14.0'],
    architecture: 'x86',
  },
  macos: {
    uaPlatformToken: 'Macintosh; Intel Mac OS X 10_15_7',
    navigatorPlatform: 'MacIntel',
    chPlatform: 'macOS',
    chPlatformVersions: ['14.6.1', '15.3.0', '15.5.0'],
    architecture: 'arm',
  },
};

function buildUaData(os: OsFamily, kernelVersion: string, rng: Rng): UaData {
  const identity = OS_IDENTITY[os];
  return {
    // The kernel builds the brand lists from this name and the version. They contain
    // a deliberately odd "GREASE" entry whose spelling and position change with every
    // major version, so only the browser's own generator gets them right.
    brand: 'Google Chrome',
    brands: [],
    fullVersionList: [],
    fullVersion: kernelVersion,
    platform: identity.chPlatform,
    platformVersion: pick(rng, identity.chPlatformVersions),
    architecture: identity.architecture,
    bitness: '64',
    model: '',
    mobile: false,
    wow64: false,
  };
}

function buildScreen(os: OsFamily, rng: Rng): ScreenInfo {
  const [width, height, bar] = pick(rng, SCREENS[os]);
  return { width, height, availWidth: width, availHeight: height - bar, colorDepth: 24 };
}

/** A random unsigned 64-bit seed, never zero. */
export function randomSeed(): string {
  const value = randomBytes(8).readBigUInt64BE(0);
  return (value === 0n ? 1n : value).toString();
}

export function hostOs(): OsFamily {
  if (process.platform === 'win32') return 'windows';
  if (process.platform === 'darwin') return 'macos';
  return 'linux';
}

export type GeneratedIdentity = Pick<Profile,
  'seed' | 'os' | 'userAgent' | 'platform' | 'uaData' | 'hardwareConcurrency' |
  'deviceMemory' | 'screen' | 'webgl' | 'noise' | 'fonts'>;

/**
 * Builds a fresh identity for `os`, matching kernel version `kernelVersion`
 * (e.g. "158.0.8127.37") so the user agent agrees with the browser actually running.
 */
export function generateIdentity(os: OsFamily, kernelVersion: string, rng: Rng = cryptoRng): GeneratedIdentity {
  const major = kernelVersion.split('.')[0];
  const identity = OS_IDENTITY[os];
  const gpu = pick(rng, GPUS[os]);
  return {
    seed: randomSeed(),
    os,
    userAgent: `Mozilla/5.0 (${identity.uaPlatformToken}) AppleWebKit/537.36 (KHTML, like Gecko) ` +
               `Chrome/${major}.0.0.0 Safari/537.36`,
    platform: identity.navigatorPlatform,
    uaData: buildUaData(os, kernelVersion, rng),
    hardwareConcurrency: pick(rng, CORES[os]),
    deviceMemory: pick(rng, MEMORY[os]),
    screen: buildScreen(os, rng),
    webgl: { vendor: gpu.vendor, renderer: gpu.renderer },
    noise: { canvas: true, audio: true },
    fonts: [...FONTS[os]],
  };
}

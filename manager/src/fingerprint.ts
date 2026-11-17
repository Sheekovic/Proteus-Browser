// Generates a coherent browser identity for a new profile.
//
// "Coherent" means the parts agree with each other the way they do on a real
// machine: a Windows user agent comes with Windows client hints, a Direct3D GPU
// string and a common Windows screen size. The value pools below are ordinary,
// widely seen desktop configurations; nothing here is copied from another product.

import { randomBytes } from 'node:crypto';
import { release } from 'node:os';
import type { OsFamily, Profile, ScreenInfo, UaData } from './profile.ts';
import { generateAndroidIdentity } from './android.ts';
import { generateIosIdentity } from './ios.ts';
import { mediaDevicesFor } from './mediaDevices.ts';
import { voicesFor } from './voices.ts';

/** The systems with a desktop identity generator; phones have their own (android.ts, ios.ts). */
export type DesktopOs = Exclude<OsFamily, 'android' | 'ios'>;

/** Returns a uniformly distributed integer in [0, bound). */
export type Rng = (bound: number) => number;

export const cryptoRng: Rng = (bound) => randomBytes(4).readUInt32BE(0) % bound;

function pick<T>(rng: Rng, items: readonly T[]): T {
  return items[rng(items.length)];
}

export interface Gpu {
  /** WEBGL_debug_renderer_info strings. */
  vendor: string;
  renderer: string;
  /** GPUAdapterInfo.vendor and .architecture of the same hardware. */
  webgpu: { vendor: string; architecture: string };
}

// [width, height, taskbar/dock height]
const SCREENS: Record<DesktopOs, readonly (readonly [number, number, number])[]> = {
  windows: [[1920, 1080, 48], [1920, 1080, 40], [1366, 768, 40], [1536, 864, 48], [2560, 1440, 48], [1600, 900, 40]],
  linux: [[1920, 1080, 27], [1920, 1080, 0], [2560, 1440, 27], [1366, 768, 27], [1680, 1050, 27]],
  macos: [[1440, 900, 25], [1512, 982, 38], [1728, 1117, 38], [1680, 1050, 25], [2560, 1440, 25]],
};

// The third argument is the WebGPU "architecture": the GPU generation name the
// browser reports for that hardware (Intel gen-9, NVIDIA Turing, AMD GCN 4, ...).
export const d3d11 = (vendor: string, device: string, architecture: string): Gpu => ({
  vendor: `Google Inc. (${vendor})`,
  renderer: `ANGLE (${vendor}, ${device} Direct3D11 vs_5_0 ps_5_0, D3D11)`,
  webgpu: { vendor: vendor.toLowerCase(), architecture },
});
export const openGl = (vendor: string, device: string, webgpuVendor: string, architecture: string): Gpu => ({
  vendor: `Google Inc. (${vendor})`,
  renderer: `ANGLE (${vendor}, ${device})`,
  webgpu: { vendor: webgpuVendor, architecture },
});
export const metal = (chip: string): Gpu => ({
  vendor: 'Google Inc. (Apple)',
  renderer: `ANGLE (Apple, ANGLE Metal Renderer: ${chip}, Unspecified Version)`,
  webgpu: { vendor: 'apple', architecture: 'metal-3' },
});

const GPUS: Record<DesktopOs, readonly Gpu[]> = {
  windows: [
    d3d11('Intel', 'Intel(R) UHD Graphics 630 (0x00003E9B)', 'gen-9'),
    d3d11('Intel', 'Intel(R) UHD Graphics 620 (0x00005917)', 'gen-9'),
    d3d11('Intel', 'Intel(R) Iris(R) Xe Graphics (0x00009A49)', 'gen-12lp'),
    d3d11('NVIDIA', 'NVIDIA GeForce GTX 1650 (0x00001F82)', 'turing'),
    d3d11('NVIDIA', 'NVIDIA GeForce GTX 1660 SUPER (0x000021C4)', 'turing'),
    d3d11('NVIDIA', 'NVIDIA GeForce RTX 3060 (0x00002503)', 'ampere'),
    d3d11('NVIDIA', 'NVIDIA GeForce RTX 4060 (0x00002882)', 'lovelace'),
    d3d11('AMD', 'AMD Radeon RX 580 Series (0x000067DF)', 'gcn-4'),
    d3d11('AMD', 'AMD Radeon(TM) Graphics (0x00001636)', 'gcn-5'),
  ],
  linux: [
    openGl('Intel', 'Mesa Intel(R) UHD Graphics 630 (CFL GT2), OpenGL 4.6', 'intel', 'gen-9'),
    openGl('Intel', 'Mesa Intel(R) Xe Graphics (TGL GT2), OpenGL 4.6', 'intel', 'gen-12lp'),
    openGl('AMD', 'AMD Radeon RX 580 Series (radeonsi, polaris10, LLVM 17.0.6, DRM 3.57), OpenGL 4.6',
      'amd', 'gcn-4'),
    openGl('NVIDIA Corporation', 'NVIDIA GeForce GTX 1650/PCIe/SSE2, OpenGL 4.5.0', 'nvidia', 'turing'),
  ],
  macos: [metal('Apple M1'), metal('Apple M2'), metal('Apple M3 Pro')],
};

/** A computer as far as its processor and memory go. */
export interface Machine {
  /** navigator.hardwareConcurrency */
  cores: number;
  /** navigator.deviceMemory: the installed memory rounded down to a power of two, 32 at most. */
  memory: number;
  /** On a Mac the chip is also the graphics card; absent elsewhere. */
  gpu?: Gpu;
}

// Processor and memory go together: a four-core office machine does not have 32 GB,
// and a sixteen-core one rarely has 8. An entry listed twice is twice as likely.
const MACHINES: Record<DesktopOs, readonly Machine[]> = {
  windows: [
    { cores: 4, memory: 8 }, { cores: 4, memory: 8 }, { cores: 6, memory: 8 }, { cores: 6, memory: 16 },
    { cores: 8, memory: 8 }, { cores: 8, memory: 16 }, { cores: 8, memory: 16 }, { cores: 12, memory: 16 },
    { cores: 12, memory: 16 }, { cores: 12, memory: 32 }, { cores: 16, memory: 16 }, { cores: 16, memory: 32 },
  ],
  linux: [
    { cores: 4, memory: 8 }, { cores: 8, memory: 8 }, { cores: 8, memory: 16 }, { cores: 8, memory: 16 },
    { cores: 12, memory: 16 }, { cores: 16, memory: 16 }, { cores: 16, memory: 32 },
  ],
  // Apple sells each chip with a fixed number of cores and two or three memory sizes
  // (18 GB reads as 16, 36 GB as 32).
  macos: [
    { cores: 8, memory: 8, gpu: metal('Apple M1') }, { cores: 8, memory: 16, gpu: metal('Apple M1') },
    { cores: 8, memory: 8, gpu: metal('Apple M2') }, { cores: 8, memory: 16, gpu: metal('Apple M2') },
    { cores: 12, memory: 16, gpu: metal('Apple M3 Pro') }, { cores: 12, memory: 32, gpu: metal('Apple M3 Pro') },
  ],
};

// Font families that ship with a default installation of each system. A profile
// exposes these and hides anything else found on the machine (fonts added by office
// suites, design tools and so on are a strong, stable identifier).
// The Windows names were checked against an unmodified browser on Windows 11: each is
// a name it resolves as a font family there. "MS Sans Serif" and the like are not
// font files but names Windows itself maps to other fonts, on every installation.
const FONTS: Record<DesktopOs, readonly string[]> = {
  windows: [
    'Arial', 'Arial Black', 'Bahnschrift', 'Calibri', 'Cambria', 'Cambria Math', 'Candara',
    'Comic Sans MS', 'Consolas', 'Constantia', 'Corbel', 'Courier New', 'Ebrima',
    'Franklin Gothic Medium', 'Gabriola', 'Gadugi', 'Georgia', 'Impact',
    'Ink Free', 'Javanese Text', 'Leelawadee UI', 'Lucida Console', 'Lucida Sans Unicode',
    'Malgun Gothic', 'Marlett', 'Microsoft Himalaya', 'Microsoft JhengHei',
    'Microsoft JhengHei UI', 'Microsoft New Tai Lue', 'Microsoft PhagsPa',
    'Microsoft Sans Serif', 'Microsoft Tai Le', 'Microsoft YaHei', 'Microsoft YaHei UI',
    'Microsoft Yi Baiti', 'MingLiU-ExtB', 'MingLiU_HKSCS-ExtB', 'Mongolian Baiti', 'MS Gothic',
    'MS PGothic', 'MS Sans Serif', 'MS Serif', 'MS Shell Dlg', 'MS Shell Dlg 2', 'MS UI Gothic', 'MV Boli', 'Myanmar Text', 'Nirmala UI', 'NSimSun',
    'Palatino Linotype', 'PMingLiU-ExtB', 'Segoe MDL2 Assets', 'Segoe Print', 'Segoe Script',
    'Segoe UI', 'Segoe UI Emoji', 'Segoe UI Historic', 'Segoe UI Symbol', 'SimSun',
    'SimSun-ExtB', 'Sitka Banner', 'Sitka Display', 'Sitka Heading', 'Sitka Small', 'Sitka Subheading',
    'Sitka Text', 'Sylfaen', 'Symbol', 'Tahoma', 'Times New Roman', 'Trebuchet MS',
    'Verdana', 'Webdings', 'Wingdings', 'Yu Gothic', 'Yu Gothic UI',
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

/** Fonts Windows 11 added to the set every Windows 10 installation has. */
const WINDOWS_11_FONTS: readonly string[] = [
  'Cascadia Code', 'Cascadia Mono', 'Sans Serif Collection', 'Segoe Fluent Icons',
  'Segoe UI Variable Display', 'Segoe UI Variable Small', 'Segoe UI Variable Text',
];
/** Fonts only Windows 10 has. */
const WINDOWS_10_FONTS: readonly string[] = ['HoloLens MDL2 Assets'];

/**
 * The fonts a fresh installation of the claimed system has. Detection scripts tell
 * Windows versions apart by them, so the list must agree with the version the client
 * hints report (13 and above means Windows 11).
 */
function fontsFor(os: DesktopOs, platformVersion: string): string[] {
  const fonts = [...FONTS[os]];
  if (os === 'windows') {
    fonts.push(...(Number(platformVersion.split('.')[0]) >= 13 ? WINDOWS_11_FONTS : WINDOWS_10_FONTS));
  }
  return fonts.sort((a, b) => a.localeCompare(b));
}

interface OsIdentity {
  uaPlatformToken: string;
  navigatorPlatform: string;
  chPlatform: string;
  chPlatformVersions: readonly string[];
  architecture: string;
}

const OS_IDENTITY: Record<DesktopOs, OsIdentity> = {
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

/** Whether this machine runs Windows 11 (build 22000 or later); undefined when it is not Windows. */
function hostIsWindows11(): boolean | undefined {
  if (process.platform !== 'win32') return undefined;
  return Number(release().split('.')[2]) >= 22000;
}

/**
 * The client-hint platform versions a new profile may claim. A Windows profile on a
 * Windows machine keeps to the machine's own generation: Windows 10 and 11 ship
 * different fonts, and claiming the other one means hiding fonts that are present and
 * standing in for ones that are not, which detection sites notice.
 */
function platformVersionsFor(os: DesktopOs, all: readonly string[]): readonly string[] {
  const eleven = os === 'windows' ? hostIsWindows11() : undefined;
  if (eleven === undefined) return all;
  const matching = all.filter((version) => (Number(version.split('.')[0]) >= 13) === eleven);
  return matching.length > 0 ? matching : all;
}

function buildUaData(os: DesktopOs, kernelVersion: string, rng: Rng): UaData {
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
    platformVersion: pick(rng, platformVersionsFor(os, identity.chPlatformVersions)),
    architecture: identity.architecture,
    bitness: '64',
    model: '',
    mobile: false,
    wow64: false,
  };
}

/** The screen of [width, height, taskbar or dock height]. */
function screenOf([width, height, bar]: readonly [number, number, number]): ScreenInfo {
  return { width, height, availWidth: width, availHeight: height - bar, colorDepth: 24 };
}

/** The parts of a desktop identity a ready-made setup (presets.ts) fixes instead of leaving to chance. */
export interface DesktopChoice {
  /** [width, height, taskbar or dock height] */
  screen?: readonly [number, number, number];
  gpu?: Gpu;
  cores?: number;
  memory?: number;
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
  'deviceMemory' | 'screen' | 'mobile' | 'webgl' | 'webglCaps' | 'webgpu' | 'noise' | 'fonts' | 'voices' | 'mediaDevices'>;

/**
 * Builds a fresh identity for `os`, matching kernel version `kernelVersion`
 * (e.g. "158.0.8127.37") so the user agent agrees with the browser actually running.
 */
export function generateIdentity(os: OsFamily, kernelVersion: string, rng: Rng = cryptoRng): GeneratedIdentity {
  if (os === 'android') return generateAndroidIdentity(kernelVersion, rng);
  if (os === 'ios') return generateIosIdentity(rng);
  return generateDesktopIdentity(os, kernelVersion, rng);
}

/** The same for a computer, with the parts `choice` names fixed. */
export function generateDesktopIdentity(os: DesktopOs, kernelVersion: string, rng: Rng = cryptoRng,
                                        choice: DesktopChoice = {}): GeneratedIdentity {
  const major = kernelVersion.split('.')[0];
  const identity = OS_IDENTITY[os];
  const machine = pick(rng, MACHINES[os]);
  const gpu = choice.gpu ?? machine.gpu ?? pick(rng, GPUS[os]);
  const uaData = buildUaData(os, kernelVersion, rng);
  return {
    seed: randomSeed(),
    os,
    userAgent: `Mozilla/5.0 (${identity.uaPlatformToken}) AppleWebKit/537.36 (KHTML, like Gecko) ` +
               `Chrome/${major}.0.0.0 Safari/537.36`,
    platform: identity.navigatorPlatform,
    uaData,
    hardwareConcurrency: choice.cores ?? machine.cores,
    deviceMemory: choice.memory ?? machine.memory,
    screen: screenOf(choice.screen ?? pick(rng, SCREENS[os])),
    mobile: null,
    webgl: { vendor: gpu.vendor, renderer: gpu.renderer },
    webglCaps: null,
    webgpu: { ...gpu.webgpu },
    noise: { canvas: true, audio: true },
    fonts: fontsFor(os, uaData.platformVersion),
    voices: voicesFor(os),
    mediaDevices: mediaDevicesFor(os, rng),
  };
}

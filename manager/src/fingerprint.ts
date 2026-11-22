// Generates a coherent browser identity for a new profile.
//
// "Coherent" means the parts agree with each other the way they do on a real
// machine: a Windows user agent comes with Windows client hints, a Direct3D GPU
// string and a common Windows screen size. The value pools below are ordinary,
// widely seen desktop configurations; the graphics cards of Windows and Mac identities
// are from published readings of real browsers (gpus.json).

import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { release } from 'node:os';
import type { WebGLCaps } from './webglCaps.ts';
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

// --- Graphics cards as they were read from real computers --------------------------------
// gpus.json (made by tools/build-readings.mjs from readings Scrapfly published) lists, per
// system, cards as Chrome reported them, each with what it can do and the processors
// it was seen with. A new Windows or Mac identity takes one of them, as likely as it
// was seen, so its card answers with that card's own limits and extensions. The file
// has no complete reading from Linux; a Linux identity names one of the cards above
// and reports the capabilities of the machine it runs on.

interface CardReading {
  vendor: string;
  renderer: string;
  webgpu: { vendor: string; architecture: string };
  /** Index into the file's capability tables: many cards share one. */
  caps: number;
  /** How often the card was seen among Chrome on that system. */
  weight: number;
  /** navigator.hardwareConcurrency values seen with the card: [cores, how often]. */
  cores: [number, number][];
}
const READINGS = JSON.parse(readFileSync(new URL('./gpus.json', import.meta.url), 'utf8')) as {
  caps: WebGLCaps[];
  gpus: Partial<Record<DesktopOs, CardReading[]>>;
};

/**
 * Core counts a person's computer with this card has. The readings include virtual
 * machines and browsers set to report two or three cores, so a count is taken only if
 * it was seen with the card often, is four or more, and is even unless it is a Mac's.
 */
function coresOf(os: DesktopOs, card: CardReading): [number, number][] {
  const sold = os === 'macos' ? APPLE_CORES[card.renderer.match(/Apple (M\d(?: Pro| Max| Ultra)?)/)?.[1] ?? ''] : undefined;
  return card.cores.filter(([cores, share]) =>
    sold ? sold.includes(cores) : share >= 0.1 && cores >= 4 && (os === 'macos' || cores % 2 === 0));
}

// The core counts Apple sold each chip with. A reading of another count is of a
// virtual machine or a browser set to say so.
const APPLE_CORES: Record<string, readonly number[]> = {
  'M1': [8], 'M1 Pro': [8, 10], 'M1 Max': [10], 'M1 Ultra': [20],
  'M2': [8], 'M2 Pro': [10, 12], 'M2 Max': [12], 'M2 Ultra': [24],
  'M3': [8], 'M3 Pro': [11, 12], 'M3 Max': [14, 16], 'M3 Ultra': [28, 32],
  'M4': [8, 10], 'M4 Pro': [12, 14], 'M4 Max': [14, 16],
  'M5': [10],
};

/** The cards a new identity for `os` is drawn from, with their weights. Empty when the file has none. */
function cardsFor(os: DesktopOs): CardReading[] {
  return (READINGS.gpus[os] ?? []).filter((card) => coresOf(os, card).length > 0);
}

/** Picks by weight: `weights[i]` is how likely `items[i]` is against the others. */
function pickWeighted<T>(rng: Rng, items: readonly T[], weights: readonly number[]): T {
  // The generator gives whole numbers, so the weights are taken in millionths of their sum.
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  let at = rng(1_000_000) / 1_000_000 * total;
  for (let i = 0; i < items.length; i++) {
    at -= weights[i];
    if (at < 0) return items[i];
  }
  return items[items.length - 1];
}

/** What the card named by `renderer` was read to be capable of, or null when no reading names it. */
export function readCapabilities(os: DesktopOs, renderer: string): WebGLCaps | null {
  const card = (READINGS.gpus[os] ?? []).find((reading) => reading.renderer === renderer);
  return card ? structuredClone(READINGS.caps[card.caps]) : null;
}

/** How many cards with a reading a new identity for `os` is drawn from. */
export function readCardCount(os: DesktopOs): number {
  return cardsFor(os).length;
}

// Memory is not in the readings (the browsers they were taken from reported 8 for
// anything larger), so it follows the processor the way it does in shops: an entry
// listed twice is twice as likely.
function memoryFor(os: DesktopOs, cores: number, renderer: string, rng: Rng): number {
  if (os === 'macos') {
    // Apple sells each chip with two or three memory sizes (18 GB reads as 16, 36 as 32).
    if (/ (Max|Ultra)\b/.test(renderer)) return pick(rng, [32, 32]);
    if (/ Pro\b/.test(renderer)) return cores <= 8 ? 16 : pick(rng, [16, 16, 32]);
    // From the M4 on no Mac was sold with 8 GB.
    return /Apple M[123],/.test(renderer) ? pick(rng, [8, 16, 16]) : pick(rng, [16, 16, 32]);
  }
  if (cores <= 4) return pick(rng, [8, 8, 16]);
  if (cores <= 8) return pick(rng, [8, 16, 16]);
  if (cores <= 12) return pick(rng, [16, 16, 32]);
  return pick(rng, [16, 32, 32]);
}

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

/** A screen a ready-made setup names: [width, height, taskbar or dock height, pixel ratio, colour depth]. */
export type ChosenScreen = readonly [number, number, number, number?, number?];

/** The screen of a ready-made setup. */
function screenOf([width, height, bar, ratio = 1, depth = 24]: ChosenScreen): ScreenInfo {
  return { width, height, availWidth: width, availHeight: height - bar, colorDepth: depth, devicePixelRatio: ratio };
}

// --- Screens as they were read from real computers ---------------------------------------
// screens.json (made by tools/build-readings.mjs, from the same readings as the cards)
// lists the screens Chrome reported, each with its work area, colour depth and the
// pixel ratio it was read with. Size and ratio belong together: 1536 by 864 is a
// 1920 by 1080 laptop panel at 125%, and is not found at 100%.

interface ScreenReading extends ScreenInfo {
  devicePixelRatio: number;
  weight: number;
}
const SCREEN_READINGS = (JSON.parse(readFileSync(new URL('./screens.json', import.meta.url), 'utf8')) as {
  screens: Partial<Record<DesktopOs, ScreenReading[]>>;
}).screens;

// Which Macs have which built-in screen (in the sizes a page sees). A size not listed
// is a monitor plugged in, which any Mac can have; a desktop Mac has nothing else.
const MAC_SCREENS: Record<string, RegExp> = {
  '1280x800': /Apple M[12],/,                       // 13-inch Air and Pro, scaled
  '1440x900': /Apple M[12],/,                       // 13-inch Air (M1) and Pro
  '1470x956': /Apple M[2-9],/,                      // 13-inch Air from the M2
  '1710x1107': /Apple M[2-9],/,                     // 15-inch Air
  '1710x1112': /Apple M[2-9],/,
  '1512x982': /Apple M(\d (Pro|Max)|[3-9]),/,       // 14-inch Pro
  '1728x1117': /Apple M\d (Pro|Max),/,              // 16-inch Pro
  '1800x1169': /Apple M\d (Pro|Max),/,              // 14-inch Pro, scaled
  '2056x1329': /Apple M\d (Pro|Max),/,              // 16-inch Pro, scaled
};

/** The screens a computer with the card `renderer` can have, among those that were read. */
function screensFor(os: DesktopOs, renderer: string): ScreenReading[] {
  const all = SCREEN_READINGS[os] ?? [];
  if (os !== 'macos') return all;
  return all.filter((screen) => {
    const builtIn = MAC_SCREENS[`${screen.width}x${screen.height}`];
    return builtIn ? builtIn.test(renderer) : true;
  });
}

/** How many screens with a reading a new identity for `os` is drawn from. */
export function readScreenCount(os: DesktopOs): number {
  return (SCREEN_READINGS[os] ?? []).length;
}

/** The screen a setup names, or one that was read, as likely as it was seen; a common one without readings. */
function chooseScreen(os: DesktopOs, renderer: string, rng: Rng, chosen?: ChosenScreen): ScreenInfo {
  if (chosen) return screenOf(chosen);
  const read = screensFor(os, renderer);
  if (read.length === 0) return screenOf(pick(rng, SCREENS[os]));
  const { weight: _weight, ...screen } = pickWeighted(rng, read, read.map((reading) => reading.weight));
  return screen;
}

/** The parts of a desktop identity a ready-made setup (presets.ts) fixes instead of leaving to chance. */
export interface DesktopChoice {
  screen?: ChosenScreen;
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
 * (e.g. "157.0.8103.79") so the user agent agrees with the browser actually running.
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
  let machine = pick(rng, MACHINES[os]);
  let gpu = choice.gpu ?? machine.gpu ?? pick(rng, GPUS[os]);
  // Unless a ready-made setup names the card: one that was read from a real computer,
  // with a processor it was seen with.
  const cards = choice.gpu ? [] : cardsFor(os);
  if (cards.length > 0) {
    const card = pickWeighted(rng, cards, cards.map((reading) => reading.weight));
    const usual = coresOf(os, card);
    const cores = pickWeighted(rng, usual, usual.map(([, share]) => share))[0];
    gpu = { vendor: card.vendor, renderer: card.renderer, webgpu: { ...card.webgpu } };
    machine = { cores, memory: memoryFor(os, cores, card.renderer, rng) };
  }
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
    screen: chooseScreen(os, gpu.renderer, rng, choice.screen),
    mobile: null,
    webgl: { vendor: gpu.vendor, renderer: gpu.renderer },
    // The card's own capabilities when a reading names it; without one the kernel
    // reports those of the machine it runs on.
    webglCaps: readCapabilities(os, gpu.renderer),
    webgpu: { ...gpu.webgpu },
    noise: { canvas: true, audio: true },
    fonts: fontsFor(os, uaData.platformVersion),
    voices: voicesFor(os),
    mediaDevices: mediaDevicesFor(os, rng),
  };
}

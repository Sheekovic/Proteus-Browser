// Fingerprints read from real devices by the collector page (ui/collect.html), and
// how one becomes the identity of a profile.
//
// A collected fingerprint is untrusted input: it arrives as a file or a paste from
// another device. parseCollected() keeps only known fields, with bounds, and
// identityFromCollected() maps them onto what the kernel can reproduce:
//  - a Chromium-family browser on Windows, macOS, Linux or Android becomes a Chrome
//    profile of the running kernel's version on that device's hardware;
//  - Safari on an iPhone becomes an iPhone profile with that phone's screen;
//  - anything else (Firefox, desktop Safari, ...) is refused, since the kernel
//    cannot pass for those browsers.

import type { GeneratedIdentity } from './fingerprint.ts';
import { randomSeed } from './fingerprint.ts';
import { cleanWebGLCaps, type WebGLCaps } from './webglCaps.ts';
import { type OsFamily, type ScreenInfo, type UaBrand, ValidationError, type Voice } from './profile.ts';

export interface CollectedUaData {
  brands: UaBrand[];
  fullVersionList: UaBrand[];
  mobile: boolean;
  platform: string;
  platformVersion: string;
  architecture: string;
  bitness: string;
  model: string;
  uaFullVersion: string;
  wow64: boolean;
}

export interface Collected {
  format: 'proteus-fingerprint';
  version: 1;
  collectedAt: string;
  label: string;
  secureContext: boolean;
  userAgent: string;
  platform: string;
  vendor: string;
  uaData: CollectedUaData | null;
  hardwareConcurrency: number;
  deviceMemory: number | null;
  maxTouchPoints: number;
  screen: ScreenInfo;
  devicePixelRatio: number;
  innerWidth: number;
  innerHeight: number;
  webgl: { vendor: string; renderer: string } | null;
  /** Absent in readings made before the collector read it. */
  webglCaps: WebGLCaps | null;
  webgpu: { vendor: string; architecture: string } | null;
  voices: Voice[];
  fonts: string[];
}

// The kernel receives its configuration on the command line, which is short on
// Windows (launcher.ts refuses a configuration over 16,000 bytes). These budgets, in
// bytes of that configuration, keep a profile made from a fingerprint inside it.
// A font costs its name twice plus the substitutes named for it.
const FONT_BUDGET = 6000;
const VOICE_BUDGET = 3000;
const fontCost = (name: string): number => 2 * Buffer.byteLength(name) + 50;
const voiceCost = (voice: Voice): number => Buffer.byteLength(JSON.stringify(voice)) + 1;

/** The leading items of `items` whose costs add up to at most `budget`. */
function withinBudget<T>(items: readonly T[], cost: (item: T) => number, budget: number): T[] {
  const kept: T[] = [];
  let spent = 0;
  for (const item of items) {
    spent += cost(item);
    if (spent > budget) break;
    kept.push(item);
  }
  return kept;
}

function fail(message: string): never {
  throw new ValidationError(`fingerprint: ${message}`);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== 'string' || value.length > maxLength || /[\x00-\x1f\x7f]/.test(value)) {
    fail(`${field} must be plain text of at most ${maxLength} characters`);
  }
  return value;
}

function number(value: unknown, field: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    fail(`${field} must be a number from ${min} to ${max}`);
  }
  return value;
}

function brands(value: unknown, field: string): UaBrand[] {
  if (!Array.isArray(value) || value.length > 10) fail(`${field} must be a short list`);
  return value.map((entry) => {
    if (!isObject(entry)) fail(`${field} entries must be {brand, version}`);
    return { brand: text(entry.brand, `${field}.brand`, 100), version: text(entry.version, `${field}.version`, 40) };
  });
}

function pair<A extends string, B extends string>(value: unknown, field: string, a: A, b: B): Record<A | B, string> | null {
  if (value === null || value === undefined) return null;
  if (!isObject(value)) fail(`${field} must be an object or null`);
  return { [a]: text(value[a], `${field}.${a}`, 300), [b]: text(value[b], `${field}.${b}`, 300) } as Record<A | B, string>;
}

/** Checks a collected fingerprint and returns a copy holding only the known fields. */
export function parseCollected(raw: unknown): Collected {
  if (!isObject(raw) || raw.format !== 'proteus-fingerprint') fail('this is not a Proteus fingerprint file');
  if (raw.version !== 1) fail(`version ${String(raw.version)} is not supported`);

  let uaData: CollectedUaData | null = null;
  if (raw.uaData !== null && raw.uaData !== undefined) {
    const ua = raw.uaData;
    if (!isObject(ua)) fail('uaData must be an object or null');
    uaData = {
      brands: brands(ua.brands, 'uaData.brands'),
      fullVersionList: brands(ua.fullVersionList, 'uaData.fullVersionList'),
      mobile: ua.mobile === true,
      platform: text(ua.platform, 'uaData.platform', 50),
      platformVersion: text(ua.platformVersion, 'uaData.platformVersion', 50),
      architecture: text(ua.architecture, 'uaData.architecture', 20),
      bitness: text(ua.bitness, 'uaData.bitness', 10),
      model: text(ua.model, 'uaData.model', 100),
      uaFullVersion: text(ua.uaFullVersion, 'uaData.uaFullVersion', 50),
      wow64: ua.wow64 === true,
    };
  }

  const s = raw.screen;
  if (!isObject(s)) fail('screen must be an object');
  const width = number(s.width, 'screen.width', 240, 16384);
  const height = number(s.height, 'screen.height', 240, 16384);
  const screen: ScreenInfo = {
    width, height,
    availWidth: number(s.availWidth, 'screen.availWidth', 1, width),
    availHeight: number(s.availHeight, 'screen.availHeight', 1, height),
    colorDepth: number(s.colorDepth, 'screen.colorDepth', 1, 64),
  };
  for (const [key, value] of Object.entries(screen)) {
    if (!Number.isInteger(value)) fail(`screen.${key} must be a whole number`);
  }

  if (!Array.isArray(raw.voices) || raw.voices.length > 2000) fail('voices must be a list');
  const voices = raw.voices.map((voice): Voice => {
    if (!isObject(voice)) fail('voices entries must be objects');
    return { name: text(voice.name, 'voice name', 200), lang: text(voice.lang, 'voice language', 35),
             local: voice.local === true, default: voice.default === true };
  }).filter((voice) => voice.name.trim() !== '');

  if (!Array.isArray(raw.fonts) || raw.fonts.length > 2000) fail('fonts must be a list');
  const fonts = [...new Set(raw.fonts.map((font) => text(font, 'font name', 100)).filter((f) => f.trim() !== ''))];

  return {
    format: 'proteus-fingerprint',
    version: 1,
    collectedAt: text(raw.collectedAt ?? '', 'collectedAt', 40),
    label: text(raw.label ?? '', 'label', 80),
    secureContext: raw.secureContext === true,
    userAgent: text(raw.userAgent, 'userAgent', 1000),
    platform: text(raw.platform, 'platform', 100),
    vendor: text(raw.vendor ?? '', 'vendor', 100),
    uaData,
    hardwareConcurrency: Math.round(number(raw.hardwareConcurrency, 'hardwareConcurrency', 0, 1024)),
    deviceMemory: raw.deviceMemory === null || raw.deviceMemory === undefined
        ? null : number(raw.deviceMemory, 'deviceMemory', 0, 1024),
    maxTouchPoints: Math.round(number(raw.maxTouchPoints ?? 0, 'maxTouchPoints', 0, 256)),
    screen,
    devicePixelRatio: number(raw.devicePixelRatio, 'devicePixelRatio', 0.1, 10),
    innerWidth: Math.round(number(raw.innerWidth, 'innerWidth', 1, 32768)),
    innerHeight: Math.round(number(raw.innerHeight, 'innerHeight', 1, 32768)),
    webgl: pair(raw.webgl, 'webgl', 'vendor', 'renderer'),
    webglCaps: cleanWebGLCaps(raw.webglCaps),
    webgpu: pair(raw.webgpu, 'webgpu', 'vendor', 'architecture'),
    voices,
    fonts,
  };
}

export type CollectedBrowser = 'chromium' | 'safari-ios';

/** Which kind of profile `c` can become; throws for browsers the kernel cannot pass for. */
export function classify(c: Collected): { os: OsFamily; browser: CollectedBrowser } {
  const ua = c.userAgent;
  if (/\b(iPhone|iPod)\b/.test(ua) && /Safari\//.test(ua) && !/(CriOS|FxiOS|EdgiOS|OPiOS)\//.test(ua)) {
    return { os: 'ios', browser: 'safari-ios' };
  }
  const chromium = c.uaData !== null ? c.uaData.brands.some((b) => b.brand === 'Chromium')
                                     : /\bChrome\/\d+/.test(ua) && c.vendor === 'Google Inc.';
  if (!chromium) {
    fail('only Chrome-family browsers and Safari on an iPhone can be reproduced; ' +
         'open the collector page in Chrome on that device');
  }
  const platform = c.uaData?.platform ?? '';
  if (platform === 'Android' || /\bAndroid\b/.test(ua)) return { os: 'android', browser: 'chromium' };
  if (platform === 'Windows' || /Windows NT/.test(ua)) return { os: 'windows', browser: 'chromium' };
  if (platform === 'macOS' || /Macintosh/.test(ua)) return { os: 'macos', browser: 'chromium' };
  if (platform === 'Linux' || (/\bLinux\b/.test(ua) && !/CrOS/.test(ua))) return { os: 'linux', browser: 'chromium' };
  fail(`the system "${platform || c.platform}" is not one Proteus has profiles for`);
}

const DEVICE_MEMORY_VALUES = [0.25, 0.5, 1, 2, 4, 8, 16, 32];
const COLOR_DEPTHS = [24, 30, 32, 48];

/** What Chrome puts in the user agent for each system, whatever the real version is. */
const UA_SYSTEM: Record<Exclude<OsFamily, 'ios'>, string> = {
  windows: 'Windows NT 10.0; Win64; x64',
  macos: 'Macintosh; Intel Mac OS X 10_15_7',
  linux: 'X11; Linux x86_64',
  android: 'Linux; Android 10; K',
};
const UA_DATA_DEFAULTS: Record<Exclude<OsFamily, 'ios'>, { platform: string; platformVersion: string; architecture: string; bitness: string }> = {
  windows: { platform: 'Windows', platformVersion: '15.0.0', architecture: 'x86', bitness: '64' },
  macos: { platform: 'macOS', platformVersion: '15.5.0', architecture: 'arm', bitness: '64' },
  linux: { platform: 'Linux', platformVersion: '6.8.0', architecture: 'x86', bitness: '64' },
  android: { platform: 'Android', platformVersion: '14.0.0', architecture: '', bitness: '' },
};

function phoneSettings(c: Collected, screen: ScreenInfo, barsHeight: number): NonNullable<GeneratedIdentity['mobile']> {
  // The page area as the phone reported it, when that is a plausible portrait page;
  // otherwise (a zoomed-out or rotated page) the screen less the bars.
  const plausible = c.innerWidth >= 200 && c.innerWidth <= screen.width &&
                    c.innerHeight >= 200 && c.innerHeight <= screen.height;
  return {
    viewWidth: plausible ? c.innerWidth : screen.width,
    viewHeight: plausible ? c.innerHeight : Math.max(200, screen.height - barsHeight),
    deviceScaleFactor: Math.min(5, Math.max(1, Math.round(c.devicePixelRatio * 1000) / 1000)),
    maxTouchPoints: Math.min(10, Math.max(1, c.maxTouchPoints || 5)),
  };
}

/**
 * The identity of a profile that presents itself as the device `c` was read from,
 * running kernel version `kernelVersion`. The noise seed is new on every call, so two
 * profiles made from one fingerprint are the same model of device, not the same device.
 */
export function identityFromCollected(c: Collected, kernelVersion: string): GeneratedIdentity {
  const { os, browser } = classify(c);
  const screen: ScreenInfo = { ...c.screen, colorDepth: COLOR_DEPTHS.includes(c.screen.colorDepth) ? c.screen.colorDepth : 24 };
  const cores = Math.min(256, Math.max(1, c.hardwareConcurrency || 4));
  const voices = withinBudget(c.voices, voiceCost, VOICE_BUDGET);
  const webgl = c.webgl ?? { vendor: '', renderer: '' };

  if (browser === 'safari-ios') {
    return {
      seed: randomSeed(),
      os,
      // Safari's user agent is the phone's own: it names iOS and Safari versions,
      // not the kernel's.
      userAgent: c.userAgent,
      platform: c.platform,
      uaData: { brands: [], fullVersionList: [], fullVersion: '', platform: 'iOS', platformVersion: '',
                architecture: '', bitness: '', model: '', mobile: true, wow64: false },
      hardwareConcurrency: cores,
      deviceMemory: 4,
      screen,
      webgl,
      webglCaps: c.webglCaps ?? null,
      webgpu: { vendor: '', architecture: '' },
      noise: { canvas: true, audio: true },
      fonts: [],
      voices,
      mobile: phoneSettings(c, screen, 190),
    };
  }

  const chromeOs = os as Exclude<OsFamily, 'ios'>;
  const major = kernelVersion.split('.')[0];
  const phone = os === 'android';
  const defaults = UA_DATA_DEFAULTS[chromeOs];
  const ua = c.uaData;
  return {
    seed: randomSeed(),
    os,
    // The version is the kernel's, not the collected browser's: a profile that
    // claimed another version would disagree with what the engine can do.
    userAgent: `Mozilla/5.0 (${UA_SYSTEM[chromeOs]}) AppleWebKit/537.36 (KHTML, like Gecko) ` +
               `Chrome/${major}.0.0.0 ${phone ? 'Mobile ' : ''}Safari/537.36`,
    platform: c.platform,
    uaData: {
      brand: 'Google Chrome',
      brands: [],
      fullVersionList: [],
      fullVersion: kernelVersion,
      platform: defaults.platform,
      platformVersion: ua?.platformVersion || defaults.platformVersion,
      architecture: ua ? ua.architecture : defaults.architecture,
      bitness: ua ? ua.bitness : defaults.bitness,
      model: ua?.model ?? '',
      mobile: phone,
      wow64: ua?.wow64 ?? false,
    },
    hardwareConcurrency: cores,
    deviceMemory: c.deviceMemory !== null && DEVICE_MEMORY_VALUES.includes(c.deviceMemory) ? c.deviceMemory : 8,
    screen,
    webgl,
    webglCaps: c.webglCaps ?? null,
    webgpu: c.webgpu ?? { vendor: '', architecture: '' },
    noise: { canvas: true, audio: true },
    // Phones keep the machine's fonts, as generated phone profiles do (android.ts).
    // The collector lists a system's own fonts before those that programs add, so a
    // list too long for the kernel loses the added ones first.
    fonts: phone ? [] : withinBudget(c.fonts, fontCost, FONT_BUDGET),
    voices,
    mobile: phone ? phoneSettings(c, screen, 130) : null,
  };
}

/** One line describing the device, for lists. */
export function describeCollected(c: Collected): { os: OsFamily; device: string; screen: string; gpu: string } {
  const { os } = classify(c);
  const model = c.uaData?.model || (os === 'ios' ? 'iPhone' : '');
  const system = c.uaData ? `${c.uaData.platform} ${c.uaData.platformVersion}`.trim() : c.platform;
  return {
    os,
    device: model ? `${model} (${system})` : system,
    screen: `${c.screen.width}×${c.screen.height} @${c.devicePixelRatio}x`,
    gpu: c.webgl?.renderer ?? '',
  };
}

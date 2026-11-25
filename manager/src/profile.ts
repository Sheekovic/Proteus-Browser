// The profile model: everything Proteus knows about one browser identity.

import { isIP } from 'node:net';

import { cleanMediaDevices, type MediaDevices } from './mediaDevices.ts';
import { cleanWebGLCaps, type WebGLCaps } from './webglCaps.ts';

/** 'android' is Chrome on an Android phone; 'ios' is Safari on an iPhone. */
export type OsFamily = 'windows' | 'linux' | 'macos' | 'android' | 'ios';
export const OS_FAMILIES: readonly OsFamily[] = ['windows', 'linux', 'macos', 'android', 'ios'];

/** What makes a profile a phone: the page's view and how it is touched. */
export interface MobileSettings {
  /** Page area in CSS pixels (the screen less the system and browser bars). */
  viewWidth: number;
  viewHeight: number;
  /** Device pixels per CSS pixel (window.devicePixelRatio). */
  deviceScaleFactor: number;
  maxTouchPoints: number;
}

export interface UaBrand {
  brand: string;
  version: string;
}

export interface UaData {
  /**
   * Browser brand, e.g. "Google Chrome". When set, the kernel generates the brand
   * lists itself, exactly as that browser version builds them, and `brands` /
   * `fullVersionList` are ignored. Absent on profiles saved before this existed.
   */
  brand?: string;
  brands: UaBrand[];
  fullVersionList: UaBrand[];
  fullVersion: string;
  platform: string;
  platformVersion: string;
  architecture: string;
  bitness: string;
  model: string;
  mobile: boolean;
  wow64: boolean;
}

/** One entry of speechSynthesis.getVoices(). */
export interface Voice {
  name: string;
  lang: string;
  /** localService: true for the system's own voices, false for network voices. */
  local: boolean;
  default: boolean;
  /** voiceURI, where it is not the name (Chrome's is; Safari's is an address of its own). */
  uri?: string;
}

export interface ScreenInfo {
  width: number;
  height: number;
  availWidth: number;
  availHeight: number;
  colorDepth: number;
  /**
   * window.devicePixelRatio on a computer: the scale the system shows things at, which
   * goes with the size (1536 by 864 is a 1920 by 1080 panel at 1.25). Absent means the
   * scale of the machine the profile runs on; a phone's is in `mobile`.
   */
  devicePixelRatio?: number;
  /** Where the work area starts from the top: the height of a Mac's menu bar. Absent means 0. */
  availTop?: number;
}

export interface ProxySettings {
  type: 'http' | 'socks5';
  host: string;
  port: number;
  /**
   * Login for the proxy. When set, the kernel is pointed at a local relay that logs
   * in for it (see proxyRelay.ts). Stored as given, in the profile file.
   */
  username?: string;
  password?: string;
}

export interface Profile {
  id: string;
  name: string;
  notes: string;
  /** Labels of the user's own, for finding profiles: "shop", "client A". */
  tags: string[];
  createdAt: string;
  updatedAt: string;

  /** Unsigned 64-bit decimal string. Every noise pattern is derived from it. */
  seed: string;
  os: OsFamily;

  userAgent: string;
  /** navigator.platform */
  platform: string;
  uaData: UaData;

  hardwareConcurrency: number;
  /** navigator.deviceMemory, in GiB. */
  deviceMemory: number;
  screen: ScreenInfo;
  /** Set on a phone profile; null on a desktop one. */
  mobile: MobileSettings | null;

  /** Most preferred first. Empty means "use the machine's languages". */
  languages: string[];
  /** IANA zone id. Empty means "use the machine's time zone". */
  timezone: string;

  webgl: { vendor: string; renderer: string };
  /**
   * What that graphics card can do (limits, extensions, shader precision), read from
   * a real device. null means "report the real GPU's": the case for generated
   * identities, which name a card but have no reading of it.
   */
  webglCaps: WebGLCaps | null;
  /**
   * GPUAdapterInfo.vendor / .architecture for the same GPU as `webgl`
   * ("intel" / "gen-12lp"). Empty strings mean "report the real GPU".
   */
  webgpu: { vendor: string; architecture: string };
  noise: { canvas: boolean; audio: boolean };

  /** Speech synthesis voices to report. Empty means "this machine's voices". */
  voices: Voice[];

  /**
   * The microphones, cameras and speakers pages are shown. null means "this
   * machine's", the case for profiles saved before this existed.
   */
  mediaDevices: MediaDevices | null;

  /**
   * Font families sites may find installed. Fonts on the machine that are not listed
   * are hidden. Empty means "do not filter: expose this machine's fonts".
   */
  fonts: string[];

  /**
   * 'proxyOnly': WebRTC may only use the proxy, so no direct UDP leaves the machine
   * and sites cannot learn the real IP address. 'real': stock browser behaviour.
   */
  webrtc: 'proxyOnly' | 'real';
  /**
   * Public IP address to show in WebRTC while protected, normally the proxy's exit
   * address. Sites then see ordinary-looking ICE candidates with this address; with
   * it empty they see none. Ignored when `webrtc` is 'real'.
   */
  webrtcPublicIp: string;

  /**
   * Position reported by navigator.geolocation to sites allowed to ask, in degrees
   * and metres. null means the machine's own location services (stock behaviour).
   */
  geolocation: { latitude: number; longitude: number; accuracy: number } | null;

  proxy: ProxySettings | null;
  /**
   * Before each start, ask the lookup service (see Settings.exitLookupUrl) which
   * address sites will see. Without a proxy that is this machine's own address, and
   * only an empty `webrtcPublicIp` is filled in, for that run. With a proxy it is the
   * proxy's exit: look it up through the proxy and fill in an empty
   * `timezone`, `webrtcPublicIp` and `geolocation` from it, so the browser agrees with the address
   * sites see. A start fails if the exit cannot be determined.
   */
  matchProxy: boolean;
  /** Page opened when the profile starts. Empty means the kernel's default. */
  startUrl: string;
  /**
   * A video file a page gets as the camera's picture, when it is allowed the camera:
   * the path of a .y4m or .mjpeg file on this machine. Empty means the machine's own
   * camera. With a file the microphone is silent, not the machine's.
   */
  cameraFile: string;
}

/** The fields a caller may set when creating or editing a profile. */
export type ProfileInput = Partial<Omit<Profile, 'id' | 'createdAt' | 'updatedAt'>>;

export class ValidationError extends Error {}

/** Every value any version of the format has stored; a saved profile keeps loading and saving with these. */
const DEVICE_MEMORY_VALUES = [0.25, 0.5, 1, 2, 4, 8, 16, 32];

/**
 * The values navigator.deviceMemory can have in the browser a profile of `os` presents
 * itself as. Chrome rounds the machine's memory down to a power of two and clamps it:
 * to 2-32 on a computer and to 1-8 on a phone. (Measured: an unmodified Chromium 158 on a
 * Windows machine with 93 GB reports 32. Older Chrome versions stopped at 8.) Safari
 * has no such value, so an iPhone profile's is never shown to a page.
 */
export function deviceMemoryValuesFor(os: OsFamily): readonly number[] {
  if (os === 'android') return [1, 2, 4, 8];
  if (os === 'ios') return DEVICE_MEMORY_VALUES;
  return [2, 4, 8, 16, 32];
}

/** Checks a memory value someone chose against what that browser can report. */
export function checkDeviceMemory(os: OsFamily, value: unknown): void {
  const allowed = deviceMemoryValuesFor(os);
  if (!allowed.includes(value as number)) {
    fail(`deviceMemory must be one of ${allowed.join(', ')} for a ${os} profile: ` +
         'those are the only values that browser reports');
  }
}

function fail(message: string): never {
  throw new ValidationError(message);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isIntInRange(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
}

function checkString(value: unknown, field: string, maxLength: number): void {
  if (typeof value !== 'string' || value.length > maxLength) {
    fail(`${field} must be a string of at most ${maxLength} characters`);
  }
}

function checkTimezone(zone: string): void {
  if (zone === '') return;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
  } catch {
    fail(`timezone "${zone}" is not a known IANA time zone`);
  }
}

function checkBrands(value: unknown, field: string): void {
  if (!Array.isArray(value)) fail(`${field} must be a list`);
  for (const entry of value) {
    if (!isPlainObject(entry) || typeof entry.brand !== 'string' || typeof entry.version !== 'string') {
      fail(`${field} entries must be {brand, version}`);
    }
  }
}

/** Checks proxy settings from a caller and throws ValidationError describing the first problem. */
export function validateProxy(value: unknown): asserts value is ProxySettings {
  const p = value as Record<string, unknown>;
  if (!isPlainObject(p) || (p.type !== 'http' && p.type !== 'socks5')) fail('proxy.type must be http or socks5');
  if (typeof p.host !== 'string' || !/^[A-Za-z0-9.\-:[\]]{1,255}$/.test(p.host)) fail('proxy.host is not valid');
  if (!isIntInRange(p.port, 1, 65535)) fail('proxy.port must be 1-65535');
  for (const key of ['username', 'password'] as const) {
    const field = p[key];
    // SOCKS5 limits both to 255 bytes; control characters would break HTTP headers.
    if (field !== undefined && (typeof field !== 'string' || Buffer.byteLength(field) > 255 ||
                                /[\x00-\x1f\x7f]/.test(field))) {
      fail(`proxy.${key} must be text of at most 255 bytes`);
    }
  }
  if (typeof p.username === 'string' && p.username.includes(':')) fail('proxy.username must not contain ":"');
  if ((p.password ?? '') !== '' && (p.username ?? '') === '') fail('proxy.password needs a proxy.username');
}

/**
 * Checks a complete profile and throws ValidationError describing the first problem.
 * Run on every profile before it is saved, so a stored profile can always be launched.
 * `chosen.deviceMemory` says the memory value (or the system it belongs to) is being
 * set now, by a caller or a generator: it is then held to what that system's browser
 * can report. A value saved earlier is left alone, so older profiles keep saving.
 */
export function validateProfile(profile: Profile, chosen: { deviceMemory?: boolean } = {}): void {
  checkString(profile.name, 'name', 200);
  if (profile.name.trim() === '') fail('name must not be empty');
  checkString(profile.notes, 'notes', 4000);
  if (!Array.isArray(profile.tags) || profile.tags.length > 20) fail('tags must be a list of at most 20');
  for (const tag of profile.tags) {
    if (typeof tag !== 'string' || tag.trim() === '' || tag.length > 40 || /[\x00-\x1f\x7f,]/.test(tag)) {
      fail('a tag is 1 to 40 characters without commas');
    }
  }

  if (!/^\d{1,20}$/.test(profile.seed) || BigInt(profile.seed) > 0xffff_ffff_ffff_ffffn) {
    fail('seed must be an unsigned 64-bit integer written as a decimal string');
  }
  if (!OS_FAMILIES.includes(profile.os)) fail(`os must be one of ${OS_FAMILIES.join(', ')}`);

  checkString(profile.userAgent, 'userAgent', 1000);
  checkString(profile.platform, 'platform', 100);

  const ua = profile.uaData;
  if (!isPlainObject(ua)) fail('uaData must be an object');
  if (ua.brand !== undefined) checkString(ua.brand, 'uaData.brand', 100);
  checkBrands(ua.brands, 'uaData.brands');
  checkBrands(ua.fullVersionList, 'uaData.fullVersionList');
  for (const key of ['fullVersion', 'platform', 'platformVersion', 'architecture', 'bitness', 'model'] as const) {
    checkString(ua[key], `uaData.${key}`, 200);
  }
  if (typeof ua.mobile !== 'boolean' || typeof ua.wow64 !== 'boolean') {
    fail('uaData.mobile and uaData.wow64 must be booleans');
  }

  if (!isIntInRange(profile.hardwareConcurrency, 1, 256)) fail('hardwareConcurrency must be 1-256');
  if (!DEVICE_MEMORY_VALUES.includes(profile.deviceMemory)) {
    fail(`deviceMemory must be one of ${DEVICE_MEMORY_VALUES.join(', ')}`);
  }
  if (chosen.deviceMemory && OS_FAMILIES.includes(profile.os)) checkDeviceMemory(profile.os, profile.deviceMemory);

  const s = profile.screen;
  if (!isPlainObject(s)) fail('screen must be an object');
  if (!isIntInRange(s.width, 240, 16384) || !isIntInRange(s.height, 240, 16384)) {
    fail('screen.width and screen.height are out of range');
  }
  if (!isIntInRange(s.availWidth, 1, s.width) || !isIntInRange(s.availHeight, 1, s.height)) {
    fail('screen.availWidth / availHeight must fit inside the screen');
  }
  if (![24, 30, 32, 48].includes(s.colorDepth)) fail('screen.colorDepth must be 24, 30, 32 or 48');
  if (s.devicePixelRatio !== undefined &&
      !(typeof s.devicePixelRatio === 'number' && s.devicePixelRatio >= 1 && s.devicePixelRatio <= 4)) {
    fail('screen.devicePixelRatio must be a number from 1 to 4');
  }
  if (s.availTop !== undefined && !isIntInRange(s.availTop, 0, s.height - s.availHeight)) {
    fail('screen.availTop must fit between the work area and the screen');
  }
  if (profile.mobile !== null) {
    const m = profile.mobile;
    if (!isPlainObject(m) || !isIntInRange(m.viewWidth, 200, s.width) || !isIntInRange(m.viewHeight, 200, s.height) ||
        typeof m.deviceScaleFactor !== 'number' || !(m.deviceScaleFactor >= 1 && m.deviceScaleFactor <= 5) ||
        !isIntInRange(m.maxTouchPoints, 1, 10)) {
      fail('mobile must be {viewWidth, viewHeight, deviceScaleFactor, maxTouchPoints} fitting the screen, or null');
    }
  }

  if (!Array.isArray(profile.languages) || profile.languages.length > 20) fail('languages must be a list');
  for (const language of profile.languages) {
    if (typeof language !== 'string' || !/^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(language)) {
      fail(`"${language}" is not a language tag such as en-US`);
    }
  }
  checkString(profile.timezone, 'timezone', 100);
  checkTimezone(profile.timezone);

  if (!isPlainObject(profile.webgl)) fail('webgl must be an object');
  checkString(profile.webgl.vendor, 'webgl.vendor', 300);
  checkString(profile.webgl.renderer, 'webgl.renderer', 300);
  if (!isPlainObject(profile.noise) || typeof profile.noise.canvas !== 'boolean' ||
      typeof profile.noise.audio !== 'boolean') {
    fail('noise.canvas and noise.audio must be booleans');
  }

  cleanWebGLCaps(profile.webglCaps);  // Throws on a malformed value.
  cleanMediaDevices(profile.mediaDevices);

  if (!isPlainObject(profile.webgpu)) fail('webgpu must be an object');
  checkString(profile.webgpu.vendor, 'webgpu.vendor', 100);
  checkString(profile.webgpu.architecture, 'webgpu.architecture', 100);

  if (!Array.isArray(profile.voices) || profile.voices.length > 1000) fail('voices must be a list');
  for (const voice of profile.voices) {
    if (!isPlainObject(voice) || typeof voice.name !== 'string' || voice.name.trim() === '' ||
        voice.name.length > 200 || typeof voice.lang !== 'string' || voice.lang.length > 35 ||
        typeof voice.local !== 'boolean' || typeof voice.default !== 'boolean' ||
        (voice.uri !== undefined && (typeof voice.uri !== 'string' || voice.uri === '' || voice.uri.length > 200))) {
      fail('voices entries must be {name, lang, local, default} with an optional uri');
    }
  }

  if (!Array.isArray(profile.fonts) || profile.fonts.length > 1000) fail('fonts must be a list');
  for (const font of profile.fonts) {
    if (typeof font !== 'string' || font.trim() === '' || font.length > 100) {
      fail('fonts entries must be font family names');
    }
  }
  if (profile.webrtc !== 'proxyOnly' && profile.webrtc !== 'real') fail('webrtc must be proxyOnly or real');
  if (typeof profile.webrtcPublicIp !== 'string' ||
      (profile.webrtcPublicIp !== '' && isIP(profile.webrtcPublicIp) === 0)) {
    fail('webrtcPublicIp must be an IPv4 or IPv6 address, or empty');
  }

  if (profile.proxy !== null) validateProxy(profile.proxy);

  if (profile.geolocation !== null) {
    const g = profile.geolocation;
    const inRange = (value: unknown, limit: number): boolean =>
        typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= limit;
    if (!isPlainObject(g) || !inRange(g.latitude, 90) || !inRange(g.longitude, 180) ||
        typeof g.accuracy !== 'number' || !(g.accuracy > 0 && g.accuracy <= 100000)) {
      fail('geolocation must be {latitude, longitude, accuracy} within range, or null');
    }
  }
  if (typeof profile.matchProxy !== 'boolean') fail('matchProxy must be true or false');

  checkString(profile.startUrl, 'startUrl', 2000);
  if (profile.startUrl !== '' && !/^https?:\/\//i.test(profile.startUrl)) {
    fail('startUrl must start with http:// or https://');
  }
  checkString(profile.cameraFile, 'cameraFile', 1000);
  if (profile.cameraFile !== '' && !/\.(y4m|mjpeg)$/i.test(profile.cameraFile)) {
    fail('cameraFile must be the path of a .y4m or .mjpeg file, or empty');
  }
}

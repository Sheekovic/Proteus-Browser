// The profile model: everything Proteus knows about one browser identity.

import { isIP } from 'node:net';

export type OsFamily = 'windows' | 'linux' | 'macos';

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

export interface ScreenInfo {
  width: number;
  height: number;
  availWidth: number;
  availHeight: number;
  colorDepth: number;
}

export interface ProxySettings {
  type: 'http' | 'socks5';
  host: string;
  port: number;
}

export interface Profile {
  id: string;
  name: string;
  notes: string;
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

  /** Most preferred first. Empty means "use the machine's languages". */
  languages: string[];
  /** IANA zone id. Empty means "use the machine's time zone". */
  timezone: string;

  webgl: { vendor: string; renderer: string };
  noise: { canvas: boolean; audio: boolean };

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

  proxy: ProxySettings | null;
  /** Page opened when the profile starts. Empty means the kernel's default. */
  startUrl: string;
}

/** The fields a caller may set when creating or editing a profile. */
export type ProfileInput = Partial<Omit<Profile, 'id' | 'createdAt' | 'updatedAt'>>;

export class ValidationError extends Error {}

const DEVICE_MEMORY_VALUES = [0.25, 0.5, 1, 2, 4, 8, 16, 32];

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

/**
 * Checks a complete profile and throws ValidationError describing the first problem.
 * Run on every profile before it is saved, so a stored profile can always be launched.
 */
export function validateProfile(profile: Profile): void {
  checkString(profile.name, 'name', 200);
  if (profile.name.trim() === '') fail('name must not be empty');
  checkString(profile.notes, 'notes', 4000);

  if (!/^\d{1,20}$/.test(profile.seed) || BigInt(profile.seed) > 0xffff_ffff_ffff_ffffn) {
    fail('seed must be an unsigned 64-bit integer written as a decimal string');
  }
  if (!['windows', 'linux', 'macos'].includes(profile.os)) fail('os must be windows, linux or macos');

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

  const s = profile.screen;
  if (!isPlainObject(s)) fail('screen must be an object');
  if (!isIntInRange(s.width, 320, 16384) || !isIntInRange(s.height, 240, 16384)) {
    fail('screen.width and screen.height are out of range');
  }
  if (!isIntInRange(s.availWidth, 1, s.width) || !isIntInRange(s.availHeight, 1, s.height)) {
    fail('screen.availWidth / availHeight must fit inside the screen');
  }
  if (![24, 30, 32, 48].includes(s.colorDepth)) fail('screen.colorDepth must be 24, 30, 32 or 48');

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

  if (profile.proxy !== null) {
    const p = profile.proxy;
    if (!isPlainObject(p) || (p.type !== 'http' && p.type !== 'socks5')) fail('proxy.type must be http or socks5');
    if (typeof p.host !== 'string' || !/^[A-Za-z0-9.\-:[\]]{1,255}$/.test(p.host)) fail('proxy.host is not valid');
    if (!isIntInRange(p.port, 1, 65535)) fail('proxy.port must be 1-65535');
  }

  checkString(profile.startUrl, 'startUrl', 2000);
  if (profile.startUrl !== '' && !/^https?:\/\//i.test(profile.startUrl)) {
    fail('startUrl must start with http:// or https://');
  }
}

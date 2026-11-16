// What a graphics card can do, as WebGL reports it: getParameter() limits, the
// extension list and shader precision. Read from a real device by the collector
// page and replayed by the kernel next to the card's name (kernel patch 0023), so a
// profile that claims a phone's GPU does not answer with a desktop card's limits.
//
// The shape is the kernel's own, kept short because it travels on the command line.

import { ValidationError } from './profile.ts';

export interface WebGLContextCaps {
  /** getParameter() results by GL enum (decimal): a number, or an array result's numbers. */
  p?: Record<string, number | number[]>;
  /** Extension names the card offers. Extensions not listed are hidden. */
  e?: string[];
  /**
   * getShaderPrecisionFormat() results: vertex then fragment shader, low/medium/high
   * float then low/medium/high int, each as range minimum, range maximum, precision.
   */
  s?: number[];
}

/** Keyed by WebGL version. */
export interface WebGLCaps {
  '1'?: WebGLContextCaps;
  '2'?: WebGLContextCaps;
}

const MAX_PARAMS = 80;
const MAX_EXTENSIONS = 80;

function fail(message: string): never {
  throw new ValidationError(`webglCaps: ${message}`);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

function cleanContext(value: unknown, version: string): WebGLContextCaps {
  if (!isObject(value)) fail(`"${version}" must be an object`);
  const caps: WebGLContextCaps = {};
  if (value.p !== undefined) {
    if (!isObject(value.p) || Object.keys(value.p).length > MAX_PARAMS) fail('p must be a small object');
    caps.p = {};
    for (const [name, result] of Object.entries(value.p)) {
      if (!/^[1-9]\d{0,5}$/.test(name)) fail(`"${name}" is not a GL parameter number`);
      if (isNumber(result)) {
        caps.p[name] = result;
      } else if (Array.isArray(result) && result.length >= 1 && result.length <= 4 && result.every(isNumber)) {
        caps.p[name] = [...result];
      } else {
        fail(`parameter ${name} must be a number or up to four numbers`);
      }
    }
  }
  if (value.e !== undefined) {
    if (!Array.isArray(value.e) || value.e.length > MAX_EXTENSIONS) fail('e must be a list of extension names');
    for (const name of value.e) {
      if (typeof name !== 'string' || !/^[A-Za-z0-9_]{1,60}$/.test(name)) fail('extension names are letters, digits and _');
    }
    caps.e = [...new Set(value.e as string[])];
  }
  if (value.s !== undefined) {
    if (!Array.isArray(value.s) || value.s.length !== 36 ||
        !value.s.every((n) => Number.isInteger(n) && Math.abs(n) <= 1024)) {
      fail('s must be 36 whole numbers');
    }
    caps.s = [...value.s];
  }
  return caps;
}

/**
 * Checks capabilities from an untrusted source and returns a copy holding only what
 * is known. null and undefined (no capabilities: report the real GPU) pass through
 * as null.
 */
export function cleanWebGLCaps(value: unknown): WebGLCaps | null {
  if (value === null || value === undefined) return null;
  if (!isObject(value)) fail('must be an object or null');
  const caps: WebGLCaps = {};
  for (const version of ['1', '2'] as const) {
    if (value[version] !== undefined && value[version] !== null) caps[version] = cleanContext(value[version], version);
  }
  return caps['1'] || caps['2'] ? caps : null;
}

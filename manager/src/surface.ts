// What a browser has, beyond its identity: which interfaces and functions a page finds.
//
// The kernel is desktop Chrome. Safari, and Chrome on a phone, lack things it has, and
// a page that finds `EyeDropper` or `showOpenFilePicker` in what says it is Safari
// knows better. The kernel removes what a profile's configuration lists under `hide`
// (patches 0022 and 0029): members of an interface by its name, and members of the
// global object under "globalThis", where a name ending in * removes every member
// that starts with what is before it.
//
// What Safari lacks was read from one: safari-surface.json is the difference between
// what Safari on an iPhone offers a page and what this kernel does, made by
// tools/build-surface.mjs from readings taken with tools/read-surface.mjs. Two
// things it cannot do: it removes, it does not add (what Safari has and the kernel
// lacks stays missing), and the member lists are cut to the room the kernel's
// configuration has, most looked-at interfaces first (the file says how much was left).
//
// What Chrome on a phone lacks was read the same way (android-surface.json), from a
// Galaxy before and after its Chrome was updated: version 152 and version 158, one
// older and one newer than the kernel. A name is hidden only when neither has it, so
// what Chrome gained or dropped between the two is left as the kernel has it.

import { readFileSync } from 'node:fs';

import type { OsFamily } from './profile.ts';

/** Per interface name (or "globalThis"), the members to remove. */
export type HiddenMembers = Record<string, readonly string[]>;

interface SurfaceDifference {
  /** The browser the difference was read from, as it names itself. */
  readFrom: string;
  /** Members of the global object the kernel has and that browser does not. */
  globals: string[];
  /** The same for members of interfaces both have, by interface. */
  members: Record<string, string[]>;
  notHidden: { members: number; interfaces: number };
  cannotAdd: { globals: number };
}
const SAFARI: SurfaceDifference = JSON.parse(readFileSync(new URL('./safari-surface.json', import.meta.url), 'utf8'));

/** Which Safari the iPhone list was read from, and what it leaves undone. */
export function safariReading(): Pick<SurfaceDifference, 'readFrom' | 'notHidden' | 'cannotAdd'> {
  return { readFrom: SAFARI.readFrom, notHidden: { ...SAFARI.notHidden }, cannotAdd: { ...SAFARI.cannotAdd } };
}

const ANDROID: SurfaceDifference = JSON.parse(readFileSync(new URL('./android-surface.json', import.meta.url), 'utf8'));

/**
 * What to remove for a profile of `os`. Nothing for a computer: the kernel is that
 * browser.
 */
export function hiddenFor(os: OsFamily): HiddenMembers {
  if (os === 'ios') return { globalThis: SAFARI.globals, ...SAFARI.members };
  if (os === 'android') return { globalThis: ANDROID.globals, ...ANDROID.members };
  return {};
}

/**
 * Interfaces Chrome has only on a phone, which the kernel can switch on: picking from
 * the phone's contacts (navigator.contacts), reading NFC tags (NDEFReader), reading
 * barcodes, the index of content kept for offline, and the shop's purchases. They
 * need the user's consent or a phone's hardware before they do anything, so a page
 * only finds them there.
 */
export function phoneOnlyFeatures(os: OsFamily): string[] {
  return os === 'android'
    ? ['ContactsManager', 'ContactsManagerExtraProperties', 'WebNFC', 'ContentIndex', 'DigitalGoods', 'BarcodeDetector']
    : [];
}

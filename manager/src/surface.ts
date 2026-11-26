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
  /** The same for the global object of a page alone, and of a worker alone. */
  windowGlobals: string[];
  workerGlobals: string[];
  /** The same for members of interfaces both have, by interface. */
  members: Record<string, string[]>;
  /** And for the static members of those interfaces: the ones on the interface object. */
  statics: Record<string, string[]>;
  /** Constants that go from one interface and stay on these, where the kernel fixes them again. */
  keepConstants: Record<string, string[]>;
  /**
   * What is left: members cut for room (none since patch 0031), static members nothing
   * can remove (Symbol's well-known symbols) and constants of the page's global object,
   * which is made when the kernel is built.
   */
  notHidden: { members: number; interfaces: number; fixedStatics: number; fixedConstants: number };
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
  const difference = os === 'ios' ? SAFARI : os === 'android' ? ANDROID : null;
  if (difference === null) return {};
  // As the kernel reads them (patch 0031): "window" and "worker" are the global object
  // of one kind of script alone, and a name with a dot after it is the interface
  // object, where static members are. A kernel from before leaves those entries alone.
  const hidden: Record<string, readonly string[]> = { globalThis: difference.globals };
  if (difference.windowGlobals.length > 0) hidden.window = difference.windowGlobals;
  if (difference.workerGlobals.length > 0) hidden.worker = difference.workerGlobals;
  Object.assign(hidden, difference.members);
  for (const [name, members] of Object.entries(difference.statics)) hidden[`${name}.`] = members;
  return hidden;
}

/**
 * The constants a profile of `os` hides from one interface and keeps on these. The
 * kernel cannot remove a constant without installing it removable everywhere it
 * exists; on the interfaces listed here it makes it fixed again.
 */
export function keptConstantsFor(os: OsFamily): Record<string, readonly string[]> {
  return os === 'ios' ? SAFARI.keepConstants : os === 'android' ? ANDROID.keepConstants : {};
}

/**
 * Features behind single members that Chrome on the phone was read to have and the
 * kernel has switched off: a file field's `capture`,
 * `navigator.globalPrivacyControl`, the style and layout times of a long frame, the
 * side of text on a path, an offline audio context's `close()`, and three members
 * of WebTransport. Some are Android's alone, the others Chrome turns on from its
 * servers; either way the phone has them. Three stay missing: a link's
 * `hrefTranslate`, which waits for a translating service the profile's browser does
 * not start (it would call home), and two members of a resource's timing that the
 * kernel's version of Chrome does not have yet.
 */
const ANDROID_MEMBERS = [
  'MediaCapture', 'GlobalPrivacyControl', 'LongAnimationFrameStyleDuration', 'SVGTextPathSideAttribute',
  'OfflineAudioContextIncrementalRendering', 'WebTransportAnticipatedConcurrentIncomingStreams', 'WebTransportDraining',
];

/**
 * Interfaces Chrome has only on a phone, which the kernel can switch on: picking from
 * the phone's contacts (navigator.contacts), reading NFC tags (NDEFReader), reading
 * barcodes, the index of content kept for offline, and the shop's purchases. They
 * need the user's consent or a phone's hardware before they do anything, so a page
 * only finds them there.
 */
export function phoneOnlyFeatures(os: OsFamily): string[] {
  return os === 'android'
    ? ['ContactsManager', 'ContactsManagerExtraProperties', 'WebNFC', 'ContentIndex', 'DigitalGoods', 'BarcodeDetector',
       ...ANDROID_MEMBERS]
    : [];
}

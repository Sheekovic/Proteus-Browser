// Builds manager/src/safari-surface.json: what the kernel has and Safari on an iPhone
// does not, from readings made with read-surface.mjs. An iPhone profile hides exactly
// this (surface.ts), so a page finds no interface in it that the phone's Safari lacks.
//
// usage: node build-surface.mjs <reading of the real browser> <reading of the kernel> [more kernel readings...]
//   The kernel readings are of profiles on this kernel (a computer one, and a phone
//   one, which has a few more members): whatever any of them has and the real browser
//   has not is to be hidden.
//
// The kernel's configuration has to stay small (it travels on a command line), so:
//  - names of the global object that share a beginning nothing else shares are written
//    as that beginning and a * (the fifty XR… interfaces are "XR*");
//  - members of interfaces are taken in the order pages look at them, until the room
//    is used up. What did not fit is counted in the file.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const [realFile, ...kernelFiles] = process.argv.slice(2);
if (!realFile || kernelFiles.length === 0) {
  console.error('usage: node build-surface.mjs <reading of the real browser> <reading of the kernel> [more...]');
  process.exit(2);
}
const real = JSON.parse(readFileSync(realFile, 'utf8'));
const kernels = kernelFiles.map((file) => JSON.parse(readFileSync(file, 'utf8')));
if (!real.secure) throw new Error('the real browser was not read on a secure page: much would be missing');

/** Room for the member lists, in bytes of JSON. */
const MEMBER_BUDGET = 3400;
// What Safari lacks and the profile keeps, because without it the kernel could not do
// what Safari does another way: play video in pieces (Safari has ManagedMediaSource,
// the kernel only this).
const KEEP = new Set(['MediaSource', 'SourceBuffer', 'SourceBufferList']);
// What Safari has and the profile hides all the same, because the kernel's would
// answer as the machine's graphics card and not an iPhone's.
const HIDE_ANYWAY = { Navigator: ['gpu'], WorkerNavigator: ['gpu'] };
// The interfaces a page that judges a browser looks at first.
const FIRST = ['Navigator', 'WorkerNavigator', 'Screen', 'Document', 'Element', 'HTMLElement', 'HTMLCanvasElement',
  'CanvasRenderingContext2D', 'OffscreenCanvasRenderingContext2D', 'HTMLMediaElement', 'HTMLVideoElement', 'HTMLIFrameElement',
  'Performance', 'PerformanceResourceTiming', 'Permissions', 'MediaDevices', 'AudioContext', 'BaseAudioContext',
  'RTCPeerConnection', 'Request', 'Response', 'Blob', 'EventTarget', 'Intl', 'ShadowRoot', 'SVGElement', 'MathMLElement'];

const scopes = (reading) => [reading.page, reading.worker].filter(Boolean);
const allGlobals = (reading) => new Set(scopes(reading).flatMap((scope) => scope.globals));

// --- Members of the global object -------------------------------------------------------
const realGlobals = allGlobals(real);
const kernelGlobals = new Set(kernels.flatMap((kernel) => [...allGlobals(kernel)]));
// In the page and in a worker one list is used, so a name goes only if the real
// browser has it in neither.
const extra = [...kernelGlobals].filter((name) => !realGlobals.has(name) && !KEEP.has(name)).sort();

// A beginning stands for its names when everything the kernel or the real browser has
// with that beginning is to go.
const everything = [...new Set([...kernelGlobals, ...realGlobals])];
const toHide = new Set(extra);
const patterns = [];
const covered = new Set();
const candidates = new Map();
for (const name of extra) {
  for (let length = 2; length < name.length; length++) {
    const prefix = name.slice(0, length);
    if (!candidates.has(prefix)) candidates.set(prefix, everything.filter((other) => other.startsWith(prefix)));
  }
}
// Longest saving first: a beginning that replaces the most characters.
const worth = [...candidates].filter(([, names]) => names.length >= 3 && names.every((name) => toHide.has(name)))
  .map(([prefix, names]) => ({ prefix, names, saving: names.reduce((sum, name) => sum + name.length + 3, 0) - (prefix.length + 4) }))
  .sort((a, b) => b.saving - a.saving || a.prefix.length - b.prefix.length);
for (const { prefix, names } of worth) {
  if (names.some((name) => covered.has(name))) continue;
  patterns.push(`${prefix}*`);
  for (const name of names) covered.add(name);
}
const globals = [...patterns.sort(), ...extra.filter((name) => !covered.has(name))];

// --- Members of interfaces both have ----------------------------------------------------
const membersOf = (reading, name) => {
  const found = new Set();
  let has = false;
  for (const scope of scopes(reading)) {
    const entry = scope.interfaces[name];
    if (!entry) continue;
    has = true;
    for (const member of entry.members) found.add(member);
  }
  return has ? found : null;
};
const interfaceNames = new Set(kernels.flatMap((kernel) => scopes(kernel).flatMap((scope) => Object.keys(scope.interfaces))));
const lists = {};
for (const name of interfaceNames) {
  const theirs = membersOf(real, name);
  if (!theirs) continue;   // the whole interface goes, as a member of the global object
  const mine = new Set(kernels.flatMap((kernel) => [...(membersOf(kernel, name) ?? [])]));
  const gone = [...mine].filter((member) => !theirs.has(member) && /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(member));
  for (const member of HIDE_ANYWAY[name] ?? []) if (mine.has(member) && !gone.includes(member)) gone.push(member);
  if (gone.length > 0) lists[name] = gone.sort();
}
const order = [...FIRST.filter((name) => lists[name]),
  ...Object.keys(lists).filter((name) => !FIRST.includes(name)).sort((a, b) => lists[b].length - lists[a].length || a.localeCompare(b))];
const members = {};
let used = 0, leftOut = 0, leftOutInterfaces = 0;
for (const name of order) {
  const cost = Buffer.byteLength(JSON.stringify({ [name]: lists[name] })) - 1;
  if (used + cost <= MEMBER_BUDGET) { members[name] = lists[name]; used += cost; } else { leftOut += lists[name].length; leftOutInterfaces++; }
}

// --- What cannot be done from outside: what the real browser has and the kernel lacks ---
const missing = [...realGlobals].filter((name) => !kernelGlobals.has(name)).sort();

const out = {
  note: 'Made by manager/tools/build-surface.mjs from a reading of the real browser. Not edited by hand.',
  readFrom: real.userAgent,
  readAt: real.at,
  kernel: [...new Set(kernels.map((kernel) => /Chrome\/(\d+)/.exec(kernel.userAgent)?.[1] ?? /Version\/([\d.]+)/.exec(kernel.userAgent)?.[1]))].join(', '),
  kept: [...KEEP].filter((name) => kernelGlobals.has(name) && !realGlobals.has(name)),
  hiddenAnyway: HIDE_ANYWAY,
  notHidden: { members: leftOut, interfaces: leftOutInterfaces },
  cannotAdd: { globals: missing.length },
  globals,
  members,
};
const target = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'safari-surface.json');
writeFileSync(target, JSON.stringify(out, null, 1) + '\n');
console.log(`members of the global object to hide: ${extra.length}, written as ${globals.length} entries (${patterns.length} beginnings), ` +
    `${Buffer.byteLength(JSON.stringify(globals))} bytes`);
console.log(`members of interfaces: ${Object.values(members).flat().length} in ${Object.keys(members).length} interfaces (${used} bytes); ` +
    `left out for room: ${leftOut} in ${leftOutInterfaces}`);
console.log(`the real browser has ${missing.length} names the kernel lacks (cannot be added from here)`);
console.log('beginnings:', patterns.join(' '));
console.log('written:', target);

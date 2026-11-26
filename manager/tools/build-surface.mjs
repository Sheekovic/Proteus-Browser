// Builds manager/src/safari-surface.json and manager/src/android-surface.json: what the
// kernel has and Safari on an iPhone, or Chrome on an Android phone, does not, from
// readings made with read-surface.mjs. A phone profile hides exactly this
// (surface.ts), so a page finds no interface in it that the phone's browser lacks.
//
// usage: node build-surface.mjs <safari|android> <reading of the real browser> [more...] --kernel <reading of the kernel> [more...]
//   The kernel readings are of profiles on this kernel (a computer one, and a phone
//   one, which has a few more members): whatever any of them has and the real browser
//   has not is to be hidden.
//
// The kernel's configuration travels on a command line, deflated (kernel patch 0031),
// so there is room for all of it, but none to waste:
//  - names of the global object that share a beginning nothing else shares are written
//    as that beginning and a * (the fifty XR… interfaces are "XR*");
//  - members of interfaces are taken in the order pages look at them. Should they
//    ever outgrow the room, what did not fit is counted in the file.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const [which, ...files] = process.argv.slice(2);
const split = files.indexOf('--kernel');
const realFiles = split < 0 ? [] : files.slice(0, split);
const kernelFiles = split < 0 ? [] : files.slice(split + 1);
if (!['safari', 'android'].includes(which) || realFiles.length === 0 || kernelFiles.length === 0) {
  console.error('usage: node build-surface.mjs <safari|android> <reading of the real browser> [more...] --kernel <reading of the kernel> [more...]');
  process.exit(2);
}
const reals = realFiles.map((file) => JSON.parse(readFileSync(file, 'utf8')));
const kernels = kernelFiles.map((file) => JSON.parse(readFileSync(file, 'utf8')));
if (reals.some((reading) => !reading.secure)) throw new Error('a real browser was not read on a secure page: much would be missing');

// Several readings of the real browser (two versions of it, one older and one newer
// than the kernel) count as one that has whatever any of them has: a name is hidden
// only when none has it, so what one version gained or dropped is left alone.
function together(scopeName) {
  const parts = reals.map((reading) => reading[scopeName]).filter(Boolean);
  if (parts.length === 0) return null;
  const interfaces = {};
  for (const part of parts) {
    for (const [name, entry] of Object.entries(part.interfaces)) {
      interfaces[name] ??= { members: [], statics: [] };
      interfaces[name].members = [...new Set([...interfaces[name].members, ...entry.members])];
      interfaces[name].statics = [...new Set([...interfaces[name].statics, ...entry.statics])];
    }
  }
  return { globals: [...new Set(parts.flatMap((part) => part.globals))], interfaces };
}
const real = {
  page: together('page'), worker: together('worker'),
  userAgent: reals.map((reading) => reading.userAgent).join(' | '),
  at: reals.map((reading) => reading.at).sort().at(-1),
};

/** Room for the member lists, in bytes of JSON; some 9,000 are used. */
const MEMBER_BUDGET = 30_000;
// What Safari lacks and the profile keeps, because without it the kernel could not do
// what Safari does another way: play video in pieces (Safari has ManagedMediaSource,
// the kernel only this).
const KEEP = new Set(which === 'safari' ? ['MediaSource', 'SourceBuffer', 'SourceBufferList'] : []);
// What Safari has and the profile hides all the same, because the kernel's would
// answer as the machine's graphics card and not an iPhone's.
const HIDE_ANYWAY = which === 'safari' ? { Navigator: ['gpu'], WorkerNavigator: ['gpu'] } : {};
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

// --- Members of the global object in a page alone, or in a worker alone ------------------
// What the real browser has in one and not in the other (Safari has UserActivation in
// a page and MediaStreamTrackProcessor in a worker) cannot go by the list above.
const inScope = (reading, scopeName) => new Set(reading[scopeName]?.globals ?? []);
const onlyIn = (scopeName) => {
  if (!real[scopeName]) return [];
  const theirs = new Set(real[scopeName].globals);
  const mine = new Set(kernels.flatMap((kernel) => [...inScope(kernel, scopeName)]));
  return [...mine].filter((name) => !theirs.has(name) && !toHide.has(name) && !KEEP.has(name)).sort();
};
const windowGlobals = onlyIn('page');
const workerGlobals = onlyIn('worker');

// --- Static members: those of the interface object itself --------------------------------
const staticsOf = (reading, name) => {
  const found = new Set();
  let has = false;
  for (const scope of scopes(reading)) {
    const entry = scope.interfaces[name];
    if (!entry) continue;
    has = true;
    for (const member of entry.statics ?? []) found.add(member);
  }
  return has ? found : null;
};
// Symbol's are the well-known symbols, which nothing can remove.
const FIXED_STATICS = new Set(['Symbol']);
const statics = {};
let fixedStatics = 0;
for (const name of [...interfaceNames].sort()) {
  const theirs = staticsOf(real, name);
  if (!theirs) continue;
  const mine = new Set(kernels.flatMap((kernel) => [...(staticsOf(kernel, name) ?? [])]));
  const gone = [...mine].filter((member) => !theirs.has(member) && /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(member)).sort();
  if (gone.length === 0) continue;
  if (FIXED_STATICS.has(name)) fixedStatics += gone.length; else statics[name] = gone;
}

// --- Constants ---------------------------------------------------------------------------
// The kernel can remove a constant only by installing it removable on every interface
// that has one of that name, so the interfaces that keep theirs are named: there it is
// made fixed again.
const isConstant = (member) => /^[A-Z][A-Z0-9_]*$/.test(member);
// Not Window's, though: a page's global object comes out of a snapshot made when the
// kernel was built, with its constants already fixed. They are counted as left.
const SNAPSHOT = new Set(['Window']);
let fixedConstants = 0;
for (const holder of [members, statics]) {
  for (const name of Object.keys(holder).filter((key) => SNAPSHOT.has(key))) {
    fixedConstants += holder === members ? holder[name].filter(isConstant).length : 0;
    holder[name] = holder[name].filter((member) => !isConstant(member));
    if (holder[name].length === 0) delete holder[name];
  }
}
const hiddenConstants = new Map();   // constant -> the interfaces it goes from
for (const [name, list] of [...Object.entries(members), ...Object.entries(statics)]) {
  for (const member of list.filter(isConstant)) hiddenConstants.set(member, (hiddenConstants.get(member) ?? new Set()).add(name));
}
const keepConstants = {};
for (const name of [...interfaceNames].sort()) {
  const mine = new Set(kernels.flatMap((kernel) => [...(membersOf(kernel, name) ?? []), ...(staticsOf(kernel, name) ?? [])]));
  const kept = [...hiddenConstants].filter(([member, from]) => mine.has(member) && !from.has(name)).map(([member]) => member).sort();
  if (kept.length > 0) keepConstants[name] = kept;
}

// --- What cannot be done from outside: what the real browser has and the kernel lacks ---
const missing = [...realGlobals].filter((name) => !kernelGlobals.has(name)).sort();

// --- What can be added (kernel patch 0040) ------------------------------------------------
// A reading that says what kind of thing each name is (its `shapes`) lets the kernel
// give a page the names it lacks: an interface with its members, a function, an event
// handler. An object that is there in the real browser (window.browser) cannot be
// made up, and neither can anything of a reading that only has names.
const ALIASES = { webkitIndexedDB: 'indexedDB' };
const memberShapes = (from) => Object.fromEntries(Object.entries(from ?? {}).filter(([, shape]) => /^(m\d+|a|A|c-?[\d.e+-]+)$/.test(shape)));
const add = { interfaces: [], globals: {} };
if (real.shapes) {
  const lacking = new Set(missing);
  const placed = new Set();
  const place = (name) => {
    if (placed.has(name) || !lacking.has(name)) return;
    const shape = real.shapes.interfaces[name];
    if (!shape) return;
    placed.add(name);
    place(shape.parent);   // A parent that is added too comes first.
    add.interfaces.push({ n: name, p: shape.parent, t: shape.tag, l: shape.length, m: memberShapes(shape.members), s: memberShapes(shape.statics) });
  };
  for (const name of missing) place(name);
  for (const name of missing) {
    if (placed.has(name)) continue;
    const own = real.shapes.globals[name];
    const inherited = (real.shapes.inherited[name] ?? '').split(':').pop();
    const shape = own && own !== '?' ? own : inherited;
    if (ALIASES[name] !== undefined && kernelGlobals.has(ALIASES[name])) add.globals[name] = '=' + ALIASES[name];
    else if (/^m\d+$/.test(shape)) add.globals[name] = shape;
    else if (/^[aA]$/.test(shape) && name.startsWith('on')) add.globals[name] = 'A';
    else if (shape === 'n' && name.startsWith('on')) add.globals[name] = 'A';   // A handler nobody set reads as null.
  }
}
const added = new Set([...add.interfaces.map((entry) => entry.n), ...Object.keys(add.globals)]);
const cannotAdd = missing.filter((name) => !added.has(name));

const out = {
  note: 'Made by manager/tools/build-surface.mjs from a reading of the real browser. Not edited by hand.',
  readFrom: real.userAgent,
  readAt: real.at,
  kernel: [...new Set(kernels.map((kernel) => /Chrome\/(\d+)/.exec(kernel.userAgent)?.[1] ?? /Version\/([\d.]+)/.exec(kernel.userAgent)?.[1]))].join(', '),
  kept: [...KEEP].filter((name) => kernelGlobals.has(name) && !realGlobals.has(name)),
  hiddenAnyway: HIDE_ANYWAY,
  notHidden: { members: leftOut, interfaces: leftOutInterfaces, fixedStatics, fixedConstants },
  cannotAdd: { globals: cannotAdd.length },
  add,
  globals,
  windowGlobals,
  workerGlobals,
  members,
  statics,
  keepConstants,
};
const target = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', `${which}-surface.json`);
writeFileSync(target, JSON.stringify(out, null, 1) + '\n');
console.log(`members of the global object to hide: ${extra.length}, written as ${globals.length} entries (${patterns.length} beginnings), ` +
    `${Buffer.byteLength(JSON.stringify(globals))} bytes`);
console.log(`members of interfaces: ${Object.values(members).flat().length} in ${Object.keys(members).length} interfaces (${used} bytes); ` +
    `left out for room: ${leftOut} in ${leftOutInterfaces}`);
console.log(`in a page alone: ${windowGlobals.join(' ') || 'none'}; in a worker alone: ${workerGlobals.join(' ') || 'none'}`);
console.log(`static members: ${Object.values(statics).flat().length} in ${Object.keys(statics).length} interfaces; that cannot be removed: ${fixedStatics}; constants that cannot: ${fixedConstants}`);
console.log(`constants that go: ${[...hiddenConstants.keys()].join(' ') || 'none'}; kept fixed on: ${Object.keys(keepConstants).join(' ') || 'nothing'}`);
console.log(`the real browser has ${missing.length} names the kernel lacks; given to a page: ${add.interfaces.length} interfaces and ` +
    `${Object.keys(add.globals).length} members of the global object (${Buffer.byteLength(JSON.stringify(add))} bytes); left: ${cannotAdd.join(' ') || 'none'}`);
console.log('beginnings:', patterns.join(' '));
console.log('written:', target);

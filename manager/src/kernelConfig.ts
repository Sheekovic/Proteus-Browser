// Translates a profile into what the Proteus kernel consumes: the JSON file read
// through --proteus-config, and the command line for the browser process.

import { addedFor, hiddenFor, keptConstantsFor, phoneOnlyFeatures } from './surface.ts';
import { createHash } from 'node:crypto';
import { deflateSync } from 'node:zlib';

import { androidAnswers, buildFontSubstitutes } from './fontSubstitutes.ts';
import { cameraSource, type Profile } from './profile.ts';
import { claimOf, shapeSwitches } from './transportClaim.ts';
import type { Voice } from './profile.ts';

/**
 * The most characters a configuration may take on the command lines of the kernel's
 * child processes. Windows gives a command line 32,767. Measured on a running profile,
 * the kernel's own switches take some 1,500 of them on the longest (a page's
 * process); this leaves them more than three times that.
 */
export const MAX_PACKED_CONFIG = 27_500;

/**
 * How many characters `json`, a configuration as written to the profile's kernel.json,
 * takes on those command lines: the kernel deflates it and writes that in base64
 * (patch 0031: "z:<bytes>:<base64>"). Mostly names, it comes to about a third.
 */
export function packedConfigLength(json: string): number {
  const bytes = Buffer.byteLength(json);
  return `z:${bytes}:`.length + Math.ceil(deflateSync(json, { level: 9 }).length / 3) * 4;
}

/**
 * The voices' addresses (voiceURI) as the kernel takes them (patch 0030). A voice
 * without one of its own has its name for an address, and nothing is written. Safari's
 * are long and alike ("com.apple.voice.super-compact.en-US.Samantha"), and 68 of them
 * spelled out would not fit the configuration, so what they share is written once:
 * `shapes` holds them with "%l" for the voice's language and "%n" for its last part,
 * and `written` says per voice which shape ("#1"), with which last part when that is
 * not the name without its spaces ("#1:Deranged"); "" is the first shape as it is.
 */
export function voiceAddresses(voices: readonly Voice[]): { shapes: string[]; written: string[] } {
  if (!voices.some((voice) => voice.uri !== undefined && voice.uri !== voice.name)) {
    return { shapes: [], written: voices.map(() => '') };
  }
  const parts = voices.map((voice) => {
    const uri = voice.uri ?? voice.name;
    const dot = uri.lastIndexOf('.');
    // An address the shapes cannot say (no dot, or a mark of theirs in it) is written whole.
    if (dot <= 0 || uri.includes('%') || uri.startsWith('#')) return { uri, shape: null, last: '' };
    const head = uri.slice(0, dot);
    const at = voice.lang === '' ? -1 : head.lastIndexOf(voice.lang);
    const shape = (at < 0 ? head : head.slice(0, at) + '%l' + head.slice(at + voice.lang.length)) + '.%n';
    return { uri, shape, last: uri.slice(dot + 1) };
  });
  const count = new Map<string, number>();
  for (const part of parts) if (part.shape !== null) count.set(part.shape, (count.get(part.shape) ?? 0) + 1);
  // The commonest shape first: its voices then need nothing written at all.
  const shapes = [...count].sort((a, b) => b[1] - a[1]).slice(0, 16).map(([shape]) => shape);
  const written = parts.map((part, index) => {
    const number = part.shape === null ? -1 : shapes.indexOf(part.shape);
    if (number < 0) return part.uri;
    const plain = part.last === voices[index].name.replaceAll(' ', '');
    if (number === 0 && plain) return '';
    return plain ? `#${number}` : `#${number}:${part.last}`;
  });
  return { shapes, written };
}

/** A number from 0 up to 1 that belongs to this profile and `purpose`. */
function fraction(profile: Profile, purpose: string): number {
  return createHash('sha256').update(`${profile.seed}|${purpose}`).digest().readUInt32BE(0) / 2 ** 32;
}

const BATTERY_PERIOD_MS = 6 * 3600_000;

/**
 * The battery a page is told about, never this machine's own: a laptop's real charge
 * would be the same in every profile running on it. A computer is on its charger and
 * full, which is also what one without a battery reports. A phone runs on its
 * battery: it starts each quarter of the day well charged and loses a few percent an
 * hour, the same amount whether the browser was restarted in between or not.
 */
function batteryOf(profile: Profile, now: number): Record<string, unknown> {
  if (profile.mobile === null) return { charging: true, level: 1 };
  const period = Math.floor(now / BATTERY_PERIOD_MS);
  return {
    charging: false,
    level: Math.round((0.7 + 0.3 * fraction(profile, `battery ${period}`)) * 100) / 100,
    drainPerHour: Math.round((0.04 + 0.05 * fraction(profile, 'battery drain')) * 1000) / 1000,
    at: period * BATTERY_PERIOD_MS / 1000,
  };
}

/**
 * The JSON document the kernel's config loader (base/proteus/proteus_config.cc) parses.
 * `now` is the moment of the launch, in milliseconds; `fontDir` the folder of the fonts
 * that come with Proteus, when it is there (bundled.ts).
 */
export function buildKernelConfig(profile: Profile, now: number = Date.now(), fontDir?: string): Record<string, unknown> {
  const config: Record<string, unknown> = {
    seed: profile.seed,
    userAgent: profile.userAgent,
    platform: profile.platform,
    uaData: profile.uaData,
    hardwareConcurrency: profile.hardwareConcurrency,
    deviceMemory: profile.deviceMemory,
    // A phone's one screen is built in, which a page that may ask for the screens'
    // details is told (kernel patch 0033); a computer's is left as a monitor's.
    // A computer's scale goes to the kernel as pixelRatio: pages are laid out at it
    // while the window is drawn at the machine's own (kernel patch 0035).
    screen: profile.mobile !== null ? { ...profile.screen, internal: true }
        : profile.screen.devicePixelRatio === undefined ? profile.screen
        : { ...profile.screen, pixelRatio: profile.screen.devicePixelRatio },
    canvasNoise: profile.noise.canvas,
    audioNoise: profile.noise.audio,
    webglVendor: profile.webgl.vendor,
    webglRenderer: profile.webgl.renderer,
    webRtcPolicy: profile.webrtc,
  };
  // Empty values mean "use the machine's own", which the kernel does by default.
  if (profile.fonts.length > 0) {
    config.fonts = profile.fonts;
    // Lets a claimed font the machine lacks still be found (see fontSubstitutes.ts).
    // With the fonts that come with Proteus, the stand-ins are those and the folder
    // goes to the kernel, which counts its fonts as installed (kernel patch 0038).
    config.fontAliases = buildFontSubstitutes(profile.fonts, fontDir === undefined ? {} : { shippedFor: profile.os });
    if (fontDir !== undefined) {
      config.fontDir = fontDir;
      if (profile.os === 'android') config.fontAnswers = androidAnswers(profile.fonts);
    }
  }
  if (profile.webglCaps !== null) config.webglCaps = profile.webglCaps;
  if (profile.webgpu.vendor !== '' || profile.webgpu.architecture !== '') config.webgpu = profile.webgpu;
  // The kernel takes a voice for a local one that is not the default unless told
  // otherwise, so only what differs is written: a phone's 92 voices are a third shorter.
  if (profile.voices.length > 0) {
    const addresses = voiceAddresses(profile.voices);
    if (addresses.shapes.length > 0) config.voiceUris = addresses.shapes;
    config.voices = profile.voices.map((voice, index) => ({
      name: voice.name,
      lang: voice.lang,
      ...(voice.local ? {} : { local: false }),
      ...(voice.default ? { default: true } : {}),
      ...(addresses.written[index] === '' ? {} : { uri: addresses.written[index] }),
    }));
  }
  if (profile.mediaDevices !== null) config.mediaDevices = profile.mediaDevices;
  if (profile.webrtc === 'proxyOnly' && profile.webrtcPublicIp !== '') {
    config.webRtcPublicIp = profile.webrtcPublicIp;
  }
  if (profile.mobile !== null) config.mobile = profile.mobile;
  config.battery = batteryOf(profile, now);
  // Chrome on a phone also says which kind of connection it is on; on Wi-Fi it
  // gives no upper speed. Desktop Chrome has neither value, and Safari (below) has
  // no navigator.connection or navigator.getBattery at all.
  if (profile.os === 'android') config.connection = { type: 'wifi' };
  // What desktop Chrome has and the profile's browser does not (surface.ts). A kernel
  // from before patch 0029 knows only interface names and leaves the rest.
  const hidden = hiddenFor(profile.os);
  if (Object.keys(hidden).length > 0) config.hide = hidden;
  const kept = keptConstantsFor(profile.os);
  if (Object.keys(kept).length > 0) config.keepConstants = kept;
  const added = addedFor(profile.os);
  if (added !== null) config.add = added;
  if (profile.os === 'ios') {
    // Safari: Apple's vendor string, no client hints in script or in requests, no
    // window.chrome, none of the Navigator members Safari lacks, and (unlike an
    // Android phone) the built-in PDF viewer plugins.
    delete config.uaData;
    delete config.deviceMemory;
    delete config.battery;
    config.vendor = 'Apple Computer, Inc.';
    // And Safari's network handshake (kernel patch 0028; an older kernel ignores it).
    config.transport = 'safari';
    config.clientHints = false;
    config.chromeObject = false;
    if (profile.mobile !== null) config.mobile = { ...profile.mobile, pdfViewer: true };
  }
  if (profile.geolocation !== null) config.geolocation = profile.geolocation;
  if (profile.languages.length > 0) config.languages = profile.languages;
  if (profile.timezone !== '') config.timezone = profile.timezone;
  return config;
}

export interface LaunchPaths {
  /** Chromium user data directory for this profile. */
  userDataDir: string;
  /** Where the kernel config JSON for this launch was written. */
  configFile: string;
  /**
   * Proxy for the kernel to use instead of the profile's own, as a --proxy-server
   * value: the local relay of a proxy that needs a login.
   */
  proxyServer?: string;
  /**
   * A sound file of silence, for a profile whose camera picture is not the machine's:
   * its microphone plays this.
   */
  silenceFile?: string;
  /** The video of a covered lens, for a profile whose camera shows that (coveredLens.ts). */
  coveredLensFile?: string;
  /**
   * False when the kernel's sandboxed network service could not be given access to
   * the kernel's own files (see winSandbox.ts). It would die at start and take the
   * first page with it, so the kernel is then started without that one sandbox.
   */
  networkSandbox?: boolean;
}

/**
 * Keeps a starting browser from talking to anyone before the user does: without
 * these it fetches component updates, field trials and new-tab content from the
 * browser vendor's servers, through the profile's proxy, on every start.
 */
const QUIET_START_ARGS = [
  '--disable-background-networking',
  '--disable-component-update',
  '--disable-domain-reliability',
  '--disable-sync',
  '--disable-default-apps',
  '--no-pings',
];

/** Browser features that phone home or fetch content on their own; switched off for the same reason. */
const QUIET_DISABLED_FEATURES = [
  'OptimizationHints', 'MediaRouter', 'InterestFeedContentSuggestions', 'Translate', 'PreconnectToSearch',
  'Prewarm', 'AimEnabled', 'AimServerEligibilityEnabled', 'AimServerRequestOnStartupEnabled', 'DnsOverHttpsUpgrade',
];

/**
 * Started "as administrator" on Windows, Chrome starts itself again without those
 * rights and the process that was started ends at once. Whoever started it then
 * believes the browser was closed: the manager stopped itself and left its window
 * with nothing to connect to, and a profile was reported as stopped while it ran.
 * With this the process that was started is the browser. Other systems ignore it.
 */
export const DO_NOT_DE_ELEVATE = '--do-not-de-elevate';

/** Command-line arguments for launching the kernel with `profile`. */
export function buildKernelArgs(profile: Profile, paths: LaunchPaths, extraArgs: readonly string[]): string[] {
  const args = [
    `--user-data-dir=${paths.userDataDir}`,
    `--proteus-config=${paths.configFile}`,
    // Port 0 lets the kernel choose a free port; it reports the choice in
    // <user data dir>/DevToolsActivePort, which the launcher reads back.
    '--remote-debugging-port=0',
    '--no-first-run',
    '--no-default-browser-check',
    DO_NOT_DE_ELEVATE,
    // The window must fit the screen the profile claims to have.
    // A phone's page area is emulated inside the window, which only has to be roomy
    // enough to show it under the browser's own toolbar.
    profile.mobile !== null
        ? `--window-size=${Math.max(520, profile.mobile.viewWidth + 40)},${profile.mobile.viewHeight + 140}`
        : `--window-size=${profile.screen.availWidth},${profile.screen.availHeight}`,
  ];
  // A computer's pixel ratio is the scale its system shows things at. The browser is
  // started at the profile's, so everything that follows from it (the ratio a page
  // reads, media queries, how text is laid out) is that scale's and not the host's.
  // A kernel that knows the scale from the profile (pixelRatio, above) drops this
  // switch and keeps its window at the machine's scale; an earlier one obeys it.
  if (profile.mobile === null && profile.screen.devicePixelRatio !== undefined) {
    args.push(`--force-device-scale-factor=${profile.screen.devicePixelRatio}`);
  }
  if (profile.languages.length > 0) {
    // Sets the locale Intl formats with; navigator.languages comes from the config.
    args.push(`--lang=${profile.languages[0]}`);
  }
  // Pages test for touch by looking for touch events, which exist from the start
  // only when asked for here.
  if (profile.mobile !== null) args.push('--touch-events=enabled');
  // A camera picture from a file: the kernel's stand-in devices take the place of the
  // machine's (their names are still the profile's), the picture is the file's and
  // the microphone plays a file of silence, where the stand-in would beep.
  // Without a file of its own, a profile whose devices are not the machine's shows a
  // covered lens: the machine's room and voice are not a profile's to give away.
  const source = cameraSource(profile);
  const picture = source === 'file' ? profile.cameraFile : source === 'covered' ? paths.coveredLensFile : undefined;
  if (picture !== undefined) {
    args.push('--use-fake-device-for-media-stream', `--use-file-for-fake-video-capture=${picture}`);
    if (paths.silenceFile !== undefined) args.push(`--use-file-for-fake-audio-capture=${paths.silenceFile}`);
  }
  const phoneOnly = phoneOnlyFeatures(profile.os);
  if (phoneOnly.length > 0) args.push(`--enable-blink-features=${phoneOnly.join(',')}`);
  args.push(...QUIET_START_ARGS);
  // The handshake must be that of the browser the profile claims to be (transportClaim.ts).
  const disabled = [...QUIET_DISABLED_FEATURES, ...shapeSwitches(claimOf(profile))];
  // Safari's handshake is reproduced for TLS over TCP and HTTP/2. Over QUIC the
  // kernel would be Chrome again, so a Safari profile does not use it.
  if (profile.os === 'ios') args.push('--disable-quic');
  if (paths.networkSandbox === false) disabled.push('NetworkServiceSandbox');
  args.push(`--disable-features=${disabled.join(',')}`);
  if (paths.proxyServer !== undefined) {
    args.push(`--proxy-server=${paths.proxyServer}`);
  } else if (profile.proxy) {
    const scheme = profile.proxy.type === 'socks5' ? 'socks5' : 'http';
    args.push(`--proxy-server=${scheme}://${profile.proxy.host}:${profile.proxy.port}`);
  }
  args.push(...extraArgs);
  // Without a start page the kernel would open its new-tab page, which loads
  // content from the browser vendor's servers.
  args.push(profile.startUrl !== '' ? profile.startUrl : 'about:blank');
  return args;
}

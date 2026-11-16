// Identities for iPhone profiles: Safari on iOS.
//
// Safari tells a site far less about the device than Chrome does: no model, no
// client hints, one GPU name for every iPhone. What differs between iPhones is the
// screen, so an identity is a screen size plus an iOS version. The sizes are Apple's
// published point sizes.
//
// The kernel is still Chromium. It reports Safari's identity and lacks the members
// Safari lacks (see SAFARI_MISSING), but it remains Chromium's engine underneath:
// a site that probes engine behaviour itself can still tell.

import type { GeneratedIdentity, Rng } from './fingerprint.ts';
import { randomSeed } from './fingerprint.ts';
import { voicesFor } from './voices.ts';

/** Screens in points (CSS pixels); every one of these has three device pixels per point. */
const SCREENS: readonly (readonly [number, number])[] = [
  [390, 844],  // iPhone 13, 14
  [393, 852],  // iPhone 15, 16
  [402, 874],  // iPhone 16 Pro
  [430, 932],  // iPhone 15 Plus, 16 Plus, 15 Pro Max
  [440, 956],  // iPhone 16 Pro Max
];

/** iOS versions as [user agent form, Safari version]. */
const VERSIONS: readonly (readonly [string, string])[] = [
  ['18_5', '18.5'],
  ['18_6', '18.6'],
];

/**
 * Font families iOS ships and a page can find by name (a selection of the well-known
 * ones; iOS has more). Claimed by an iPhone profile for the reason given at
 * ANDROID_FONTS in android.ts.
 */
export const IOS_FONTS: readonly string[] = [
  'American Typewriter', 'Apple Color Emoji', 'Apple SD Gothic Neo', 'Arial', 'Avenir', 'Avenir Next',
  'Avenir Next Condensed', 'Baskerville', 'Bodoni 72', 'Bradley Hand', 'Chalkboard SE', 'Chalkduster', 'Cochin',
  'Copperplate', 'Courier', 'Courier New', 'Didot', 'Futura', 'Geeza Pro', 'Georgia', 'Gill Sans', 'Helvetica',
  'Helvetica Neue', 'Hiragino Sans', 'Hoefler Text', 'Marker Felt', 'Menlo', 'Noteworthy', 'Optima', 'Palatino',
  'Papyrus', 'PingFang SC', 'Rockwell', 'Savoye LET', 'Snell Roundhand', 'Symbol', 'Times New Roman',
  'Trebuchet MS', 'Verdana', 'Zapfino',
];

/**
 * Height in points that the status bar and Safari's address and tool bars take from
 * the screen while they are all showing.
 */
const BARS_HEIGHT = 190;

/**
 * Members of Navigator that Chrome has and Safari on iOS 18 does not. The kernel
 * removes them from the page's and the workers' navigator (names an interface does
 * not have are ignored).
 */
export const SAFARI_MISSING: readonly string[] = [
  'userAgentData', 'connection', 'getBattery', 'deviceMemory', 'gpu', 'bluetooth', 'usb', 'hid', 'serial',
  'keyboard', 'scheduling', 'presentation', 'managed', 'ink', 'virtualKeyboard', 'windowControlsOverlay',
  'login', 'devicePosture', 'storageBuckets', 'xr', 'getInstalledRelatedApps', 'setAppBadge', 'clearAppBadge',
  'vibrate', 'doNotTrack', 'registerProtocolHandler', 'unregisterProtocolHandler', 'requestMIDIAccess',
  'getUserMedia', 'webkitGetUserMedia', 'webkitTemporaryStorage', 'webkitPersistentStorage',
  'joinAdInterestGroup', 'leaveAdInterestGroup', 'updateAdInterestGroups', 'clearOriginJoinedAdInterestGroups',
  'runAdAuction', 'adAuctionComponents', 'createAuctionNonce', 'canLoadAdAuctionFencedFrame',
  'getInterestGroupAdAuctionData', 'deprecatedReplaceInURN', 'deprecatedURNToURL',
  'deprecatedRunAdAuctionEnforcesKAnonymity', 'protectedAudience',
];

/** A fresh Safari-on-iPhone identity. */
export function generateIosIdentity(rng: Rng): GeneratedIdentity {
  const [width, height] = SCREENS[rng(SCREENS.length)];
  const [osVersion, safariVersion] = VERSIONS[rng(VERSIONS.length)];
  return {
    seed: randomSeed(),
    os: 'ios',
    userAgent: `Mozilla/5.0 (iPhone; CPU iPhone OS ${osVersion} like Mac OS X) AppleWebKit/605.1.15 ` +
               `(KHTML, like Gecko) Version/${safariVersion} Mobile/15E148 Safari/604.1`,
    platform: 'iPhone',
    // Safari has no client hints; the kernel is told to offer none (kernelConfig.ts)
    // and this is never sent to it.
    uaData: {
      brands: [], fullVersionList: [], fullVersion: '', platform: 'iOS', platformVersion: '',
      architecture: '', bitness: '', model: '', mobile: true, wow64: false,
    },
    // Safari reports four cores on every iPhone and has no navigator.deviceMemory;
    // the memory value only satisfies the profile format.
    hardwareConcurrency: 4,
    deviceMemory: 4,
    screen: { width, height, availWidth: width, availHeight: height, colorDepth: 24 },
    webgl: { vendor: 'Apple Inc.', renderer: 'Apple GPU' },
    webglCaps: null,
    webgpu: { vendor: '', architecture: '' },
    noise: { canvas: true, audio: true },
    fonts: [...IOS_FONTS],
    voices: voicesFor('ios'),
    mobile: { viewWidth: width, viewHeight: height - BARS_HEIGHT, deviceScaleFactor: 3, maxTouchPoints: 5 },
  };
}

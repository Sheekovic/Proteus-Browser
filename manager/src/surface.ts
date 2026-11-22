// What a browser has, beyond its identity: which interfaces and functions a page finds.
//
// The kernel is desktop Chrome. Safari, and Chrome on a phone, lack things it has, and
// a page that finds `EyeDropper` or `showOpenFilePicker` in what says it is Safari
// knows better. The kernel removes what a profile's configuration lists under `hide`
// (patches 0022 and 0029): members of an interface by its name, and members of the
// global object under "globalThis", where a name ending in * removes every member
// that starts with what is before it.
//
// The lists here are what the documentation of each browser says it lacks. They were
// not read from a phone, so they hold only what is certain: a browser missing
// something it has is noticed as easily as one having something it lacks. What is left
// in is desktop Chrome's.

import type { OsFamily } from './profile.ts';

/** Per interface name (or "globalThis"), the members to remove. */
export type HiddenMembers = Record<string, readonly string[]>;

/** Screen members of the Window Management API, which only desktop Chrome has. */
const SEVERAL_SCREENS: readonly string[] = ['isExtended', 'onchange'];

// Chrome's own additions to the web that Safari has not taken up.
const SAFARI_LACKS_GLOBALS: readonly string[] = [
  // Devices: USB, HID, serial ports, Bluetooth, MIDI, headsets.
  'USB*', 'HID*', 'Serial*', 'Bluetooth*', 'MIDI*', 'XR*',
  // Files and fonts of the computer, and its screens.
  'showOpenFilePicker', 'showSaveFilePicker', 'showDirectoryPicker', 'queryLocalFonts', 'FontData',
  'getScreenDetails', 'ScreenDetails', 'ScreenDetailed',
  'webkitRequestFileSystem', 'webkitResolveLocalFileSystemURL',
  // Windows of an installed app.
  'documentPictureInPicture', 'DocumentPictureInPicture', 'DocumentPictureInPictureEvent',
  'launchQueue', 'LaunchQueue', 'LaunchParams', 'WindowControlsOverlay*',
  // What stands behind the Navigator members Safari lacks (ios.ts).
  'NavigatorUAData', 'NetworkInformation', 'BatteryManager', 'Keyboard', 'KeyboardLayoutMap', 'Scheduling',
  'VirtualKeyboard', 'VirtualKeyboardGeometryChangeEvent', 'DevicePosture', 'StorageBucket*',
  'NavigatorManagedData', 'Ink', 'InkPresenter', 'Presentation*',
  // Other interfaces only Chrome has.
  'EyeDropper', 'IdleDetector', 'OTPCredential', 'EditContext', 'BackgroundFetch*', 'PeriodicSyncManager',
  'SyncManager',
  // Chrome's advertising interfaces and its built-in language models.
  'sharedStorage', 'SharedStorage*', 'fence', 'Fence*', 'HTMLFencedFrameElement',
  'Translator', 'LanguageDetector', 'Summarizer', 'Writer', 'Rewriter', 'LanguageModel',
  // Not here: Notification. Safari on an iPhone is said to have it only for a site added
  // to the Home Screen, but pages that test for it would then find the profile lacking
  // it, and that was not seen on a phone.
];

// What desktop Chrome has for a computer's keyboard, screens and windows, and Chrome
// on a phone does not.
const ANDROID_LACKS_GLOBALS: readonly string[] = [
  'EyeDropper', 'getScreenDetails', 'ScreenDetails', 'ScreenDetailed',
  'documentPictureInPicture', 'DocumentPictureInPicture', 'DocumentPictureInPictureEvent',
  'queryLocalFonts', 'FontData', 'Keyboard', 'KeyboardLayoutMap', 'HID*', 'WindowControlsOverlay*',
];
const ANDROID_LACKS_NAVIGATOR: readonly string[] = ['keyboard', 'hid', 'windowControlsOverlay'];

/**
 * What to remove for a profile of `os`, beside the Navigator members of a Safari
 * profile (ios.ts). Nothing for a computer: the kernel is that browser.
 */
export function hiddenFor(os: OsFamily): HiddenMembers {
  if (os === 'ios') return { globalThis: SAFARI_LACKS_GLOBALS, Screen: SEVERAL_SCREENS };
  if (os === 'android') {
    return { globalThis: ANDROID_LACKS_GLOBALS, Navigator: ANDROID_LACKS_NAVIGATOR, Screen: SEVERAL_SCREENS };
  }
  return {};
}

/**
 * Interfaces Chrome has only on a phone, which the kernel can switch on: picking from
 * the phone's contacts (navigator.contacts) and reading NFC tags (NDEFReader). Both
 * need the user's consent before they do anything, so a page only finds them there.
 */
export function phoneOnlyFeatures(os: OsFamily): string[] {
  return os === 'android' ? ['ContactsManager', 'WebNFC'] : [];
}

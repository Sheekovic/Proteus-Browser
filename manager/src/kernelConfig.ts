// Translates a profile into what the Proteus kernel consumes: the JSON file read
// through --proteus-config, and the command line for the browser process.

import { buildFontSubstitutes } from './fontSubstitutes.ts';
import { SAFARI_MISSING } from './ios.ts';
import type { Profile } from './profile.ts';

/** The JSON document the kernel's config loader (base/proteus/proteus_config.cc) parses. */
export function buildKernelConfig(profile: Profile): Record<string, unknown> {
  const config: Record<string, unknown> = {
    seed: profile.seed,
    userAgent: profile.userAgent,
    platform: profile.platform,
    uaData: profile.uaData,
    hardwareConcurrency: profile.hardwareConcurrency,
    deviceMemory: profile.deviceMemory,
    screen: profile.screen,
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
    config.fontAliases = buildFontSubstitutes(profile.fonts);
  }
  if (profile.webglCaps !== null) config.webglCaps = profile.webglCaps;
  if (profile.webgpu.vendor !== '' || profile.webgpu.architecture !== '') config.webgpu = profile.webgpu;
  if (profile.voices.length > 0) config.voices = profile.voices;
  if (profile.webrtc === 'proxyOnly' && profile.webrtcPublicIp !== '') {
    config.webRtcPublicIp = profile.webrtcPublicIp;
  }
  if (profile.mobile !== null) config.mobile = profile.mobile;
  if (profile.os === 'ios') {
    // Safari: Apple's vendor string, no client hints in script or in requests, no
    // window.chrome, none of the Navigator members Safari lacks, and (unlike an
    // Android phone) the built-in PDF viewer plugins.
    delete config.uaData;
    delete config.deviceMemory;
    config.vendor = 'Apple Computer, Inc.';
    config.clientHints = false;
    config.chromeObject = false;
    config.hide = { Navigator: SAFARI_MISSING, WorkerNavigator: SAFARI_MISSING };
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
  '--disable-features=OptimizationHints,MediaRouter,InterestFeedContentSuggestions,Translate,PreconnectToSearch,' +
      'Prewarm,AimEnabled,AimServerEligibilityEnabled,AimServerRequestOnStartupEnabled,DnsOverHttpsUpgrade,' +
      // Not about quietness: on Windows the kernel's sandboxed network service dies
      // as the browser starts and is restarted, and the start page, requested in
      // between, never loads (the window stays on a blank page).
      'NetworkServiceSandbox',
];

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
    // The window must fit the screen the profile claims to have.
    // A phone's page area is emulated inside the window, which only has to be roomy
    // enough to show it under the browser's own toolbar.
    profile.mobile !== null
        ? `--window-size=${Math.max(520, profile.mobile.viewWidth + 40)},${profile.mobile.viewHeight + 140}`
        : `--window-size=${profile.screen.availWidth},${profile.screen.availHeight}`,
  ];
  if (profile.languages.length > 0) {
    // Sets the locale Intl formats with; navigator.languages comes from the config.
    args.push(`--lang=${profile.languages[0]}`);
  }
  // Pages test for touch by looking for touch events, which exist from the start
  // only when asked for here.
  if (profile.mobile !== null) args.push('--touch-events=enabled');
  args.push(...QUIET_START_ARGS);
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

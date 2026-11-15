// Translates a profile into what the Proteus kernel consumes: the JSON file read
// through --proteus-config, and the command line for the browser process.

import { buildFontSubstitutes } from './fontSubstitutes.ts';
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
  if (profile.webrtc === 'proxyOnly' && profile.webrtcPublicIp !== '') {
    config.webRtcPublicIp = profile.webrtcPublicIp;
  }
  if (profile.languages.length > 0) config.languages = profile.languages;
  if (profile.timezone !== '') config.timezone = profile.timezone;
  return config;
}

export interface LaunchPaths {
  /** Chromium user data directory for this profile. */
  userDataDir: string;
  /** Where the kernel config JSON for this launch was written. */
  configFile: string;
}

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
    `--window-size=${profile.screen.availWidth},${profile.screen.availHeight}`,
  ];
  if (profile.languages.length > 0) {
    // Sets the locale Intl formats with; navigator.languages comes from the config.
    args.push(`--lang=${profile.languages[0]}`);
  }
  if (profile.proxy) {
    const scheme = profile.proxy.type === 'socks5' ? 'socks5' : 'http';
    args.push(`--proxy-server=${scheme}://${profile.proxy.host}:${profile.proxy.port}`);
  }
  args.push(...extraArgs);
  if (profile.startUrl !== '') args.push(profile.startUrl);
  return args;
}

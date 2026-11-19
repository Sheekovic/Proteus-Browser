// Which browser a profile claims to be, the handshake that browser makes, and whether
// the handshake a profile's kernel really makes (transport.ts) agrees with the claim.
//
// The kernel is Chromium, so its TLS and HTTP/2 code is that of the Chrome version it
// was built from. Two things can still make a profile's handshake disagree with what
// it says it is:
//
//  - An experiment. Chromium builds that are not Google's switch on features Chrome
//    itself has off. One of them (AddTLSServerHandshakePadding) adds a TLS extension,
//    0x12e0, that stock Chrome does not send. shapeSwitches() turns it off.
//  - The claim itself: a profile that says it is a Chrome of another version than the
//    kernel. The kernel has one Chrome network stack, and the manager cannot change
//    it from outside; the report says so instead of hiding it.
//
// A Safari profile is different: the kernel (from patch 0028 on) makes Safari's
// handshake when the profile's configuration asks for it, and the report compares
// what came out with what Safari on an iPhone was measured to send.
//
// The reference shapes below were measured, not looked up: each is what the named
// stock browser sent to the recorder in transport.ts.

import type { Profile } from './profile.ts';
import type { TransportShape } from './transport.ts';

export interface Claim {
  /** The browser the profile's User-Agent names. */
  browser: 'Chrome' | 'Safari' | 'unknown';
  /** Its version as claimed, e.g. "157.0.8103.79" or "27.2". */
  version: string;
  major: number | null;
  userAgent: string;
}

/** What `profile` tells sites it is. */
export function claimOf(profile: Pick<Profile, 'userAgent' | 'uaData'>): Claim {
  const userAgent = profile.userAgent;
  const chrome = /\b(?:Chrome|CriOS)\/(\d+)(?:\.[\d.]+)?/.exec(userAgent);
  if (chrome) {
    // The User-Agent gives only the major version ("157.0.0.0"); the client hints give all of it.
    const full = profile.uaData.fullVersion.startsWith(`${chrome[1]}.`) ? profile.uaData.fullVersion : chrome[0].split('/')[1];
    return { browser: 'Chrome', version: full, major: Number(chrome[1]), userAgent };
  }
  const safari = /\bVersion\/(\d+)([\d.]*) .*Safari\//.exec(userAgent);
  if (safari) return { browser: 'Safari', version: safari[1] + safari[2], major: Number(safari[1]), userAgent };
  return { browser: 'unknown', version: '', major: null, userAgent };
}

/**
 * Kernel features to switch off so that a profile making `claim` shakes hands as the
 * browser it claims to be does. Decided per claim: today every claim a profile can
 * make needs the same one, because no other difference between versions has been
 * measured (see REFERENCES); Safari's handshake is asked for in the profile's kernel
 * configuration instead (kernelConfig.ts).
 */
export function shapeSwitches(_claim: Claim): string[] {
  // On in Chromium's own trial configuration, off in Chrome: asks servers to pad
  // their handshake, in a TLS extension (0x12e0) of its own.
  return ['AddTLSServerHandshakePadding'];
}

export interface Reference {
  /** The stock browser this was measured from. */
  measuredFrom: string;
  ja4: string;
  http2: string;
  /** Its TLS extension types, sorted, for saying what differs. */
  extensions: string[];
}

/** Stock Chrome on a computer, the first connection of a new profile (no session to resume). */
const CHROME_157: Reference = {
  measuredFrom: 'Chrome 157.0.8103.79, Windows 11',
  ja4: 't13d1517h2_8daaf6152771_cb7bf5808d99',
  http2: '1:65536;2:0;4:6291456;6:262144|15663105|0|m,a,s,p',
  extensions: ['0000', '0005', '000a', '000b', '000d', '0010', '0012', '0017', '001b', '0023', '002b', '002d', '0033',
               '44cd', 'ca34', 'fe0d', 'ff01'],
};

/**
 * Safari on an iPhone, the first connection (no session to resume). Recorded from an
 * iPhone 17 Pro Max over Wi-Fi. The phone connected to an address, so its hello had no
 * server name; to a named host, as the recorder is here, Safari adds that one
 * extension (0x0000), which makes the fingerprint below: the measured one,
 * t13i2012h2_a09f3c656075_7f0f34a4126d, with "d" for the name and one extension more.
 */
const SAFARI_27: Reference = {
  measuredFrom: 'Safari 27.2, iPhone 17 Pro Max',
  ja4: 't13d2013h2_a09f3c656075_7f0f34a4126d',
  http2: '2:0;3:100;4:2097152;9:1|10420225|0|m,s,a,p',
  extensions: ['0000', '0005', '000a', '000b', '000d', '0010', '0012', '0017', '001b', '002b', '002d', '0033', 'ff01'],
};
/** The Safari major that reference was measured from. */
const SAFARI_REFERENCE = 27;

/** The oldest and newest Chrome major the reference is taken to hold for. */
const CHROME_REFERENCE_FROM = 157;
const CHROME_REFERENCE_TO = 158;

/**
 * The shape the claimed browser makes, when one has been measured for it. Chrome 157
 * was measured as a stock browser, and the kernel is that release. Chrome 158 has not
 * been (stable Chrome was 157 for nearly everyone when this was written, 158 at the
 * start of its rollout); a profile on a 158 kernel is held to the shape of 157, which
 * a kernel built from 158's source with no experiments reproduced exactly.
 */
export function referenceFor(claim: Claim): Reference | null {
  if (claim.browser === 'Chrome' && claim.major !== null &&
      claim.major >= CHROME_REFERENCE_FROM && claim.major <= CHROME_REFERENCE_TO) {
    return CHROME_157;
  }
  // One Safari was measured; an older one a profile may claim is held to it too
  // (the report says so).
  if (claim.browser === 'Safari') return SAFARI_27;
  return null;
}

export interface TransportReport {
  /** What the profile says it is. */
  claims: { browser: Claim['browser']; version: string; userAgent: string };
  /** The kernel that made the handshake. */
  kernel: { version: string };
  /** The handshake it made just now. */
  produces: TransportShape;
  /** The handshake the claimed browser makes, when that has been measured. */
  expected: { ja4: string; http2: string; measuredFrom: string } | null;
  /** True when nothing below contradicts the claim. */
  agrees: boolean;
  /** Why not, in plain words; empty when it agrees. */
  differences: string[];
  /** Things worth knowing that are not disagreements. */
  notes: string[];
}

/** Compares what was recorded with what `profile` claims. */
export function reportTransport(profile: Pick<Profile, 'userAgent' | 'uaData' | 'os'>, kernelVersion: string,
                                produces: TransportShape): TransportReport {
  const claim = claimOf(profile);
  const kernelMajor = Number(kernelVersion.split('.')[0]);
  const reference = referenceFor(claim);
  const differences: string[] = [];
  const notes: string[] = [];

  if (claim.browser === 'Safari') {
    // Nothing to say from the claim alone: what was produced is compared below.
  } else if (claim.browser === 'unknown') {
    differences.push('The profile\'s User-Agent names no browser this report knows; the kernel shakes hands as ' +
        `Chrome ${kernelMajor} does.`);
  } else if (claim.major !== kernelMajor) {
    differences.push(`The profile claims Chrome ${claim.major}, but the kernel is Chromium ${kernelMajor} and shakes hands as ` +
        `Chrome ${kernelMajor} does. Give the profile a new identity, or set its userAgent and uaData to version ${kernelMajor}.`);
  }

  if (reference) {
    if (produces.tls.ja4 !== reference.ja4) {
      const extra = produces.tls.extensions.filter((e) => !reference.extensions.includes(e));
      const missing = reference.extensions.filter((e) => !produces.tls.extensions.includes(e));
      const detail = [
        extra.length > 0 ? `extra TLS extensions ${extra.map((e) => '0x' + e).join(', ')}` : '',
        missing.length > 0 ? `missing TLS extensions ${missing.map((e) => '0x' + e).join(', ')}` : '',
      ].filter(Boolean).join('; ');
      differences.push(`TLS: produced ${produces.tls.ja4}, ${reference.measuredFrom} sends ${reference.ja4}` +
          (detail ? ` (${detail})` : ' (same extensions; the ciphers or signature algorithms differ)') + '.');
      if (claim.browser === 'Safari' && produces.tls.ja4 === CHROME_157.ja4) {
        differences.push(`The profile claims Safari ${claim.version}, but this kernel shakes hands as Chrome does: ` +
            'it is from before Safari\'s handshake was added (kernel patch 0028).');
      }
    }
    if (produces.http2 !== null && produces.http2.fingerprint !== reference.http2) {
      differences.push(`HTTP/2: produced ${produces.http2.fingerprint}, ${reference.measuredFrom} sends ${reference.http2}.`);
    }
    if (claim.browser === 'Chrome' && claim.major !== null && claim.major > CHROME_REFERENCE_FROM) {
      notes.push(`A stock Chrome ${claim.major} has not been measured: the expected shape is that of ${reference.measuredFrom}.`);
    }
    if (claim.browser === 'Safari') {
      if (claim.major !== SAFARI_REFERENCE) {
        notes.push(`A Safari ${claim.version} has not been measured: the expected shape is that of ${reference.measuredFrom}.`);
      }
      notes.push('Only the handshake is Safari\'s. Over QUIC (HTTP/3) the kernel would be Chrome again, so a Safari ' +
          'profile does not use it; and the engine behind the handshake is still Chromium\'s.');
    }
  } else if (claim.browser === 'Chrome' && claim.major === kernelMajor) {
    notes.push(`No stock Chrome ${claim.major} has been measured to compare with; the kernel's own version matches the claim.`);
  }
  if (produces.http2 === null) {
    differences.push('The browser did not go on to HTTP/2 after its TLS hello, so only the hello was recorded.');
  }
  if (produces.userAgent !== null && produces.userAgent !== claim.userAgent) {
    differences.push(`The request carried the User-Agent "${produces.userAgent}", not the profile's.`);
  }
  if (profile.os === 'android' || profile.os === 'macos' || profile.os === 'linux') {
    notes.push('The reference was measured on Windows. Chrome uses the same network code on every system, ' +
        `but a stock Chrome on ${profile.os === 'android' ? 'Android' : profile.os === 'macos' ? 'macOS' : 'Linux'} was not measured.`);
  }
  if (produces.tls.resumption) {
    notes.push('The hello offered to resume a session, which adds one extension (0x0029) and changes the fingerprint.');
  }
  return {
    claims: { browser: claim.browser, version: claim.version, userAgent: claim.userAgent },
    kernel: { version: kernelVersion },
    produces,
    expected: reference ? { ja4: reference.ja4, http2: reference.http2, measuredFrom: reference.measuredFrom } : null,
    agrees: differences.length === 0,
    differences,
    notes,
  };
}

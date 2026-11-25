// Finds out where a profile's proxy comes out, so the profile can match it.
//
// A site sees the proxy's exit address. If the browser then reports the machine's own
// time zone, or WebRTC shows no address or a different one, the mismatch gives the
// proxy away. Before a profile with a proxy starts, the manager therefore asks a
// lookup service, through that proxy, which address and time zone the exit has.

import { isIP, type Socket } from 'node:net';
import { connect as tlsConnect } from 'node:tls';

import { languagesOf } from './languages.ts';
import type { Profile, ProxySettings } from './profile.ts';
import { openTunnel } from './proxyRelay.ts';

export interface ProxyExit {
  /** Address sites see. */
  ip: string;
  /**
   * The exit's IPv4 address, when `ip` is an IPv6 one and the exit has both. Sites
   * reached over IPv4 see this one, and it is the form WebRTC shows.
   */
  ipv4?: string;
  /** IANA time zone of that address, or '' when the service did not say. */
  timezone: string;
  /** Rough position of that address (its city), when the service gave one. */
  latitude?: number;
  longitude?: number;
  /** The country of that address as two capital letters ("DE"), when the service said. */
  country?: string;
}

const LOOKUP_TIMEOUT_MS = 15_000;
const MAX_REPLY_BYTES = 256 * 1024;
/**
 * A proxy's exits come and go, residential ones especially: the same request is
 * refused one moment and served the next, and some exits cannot reach some services.
 * So every service is asked in turn, and the whole list again after a pause, until
 * one answers or this much time has passed.
 */
const LOOKUP_ROUNDS = 3;
const LOOKUP_PAUSE_MS = 1_500;
const LOOKUP_DEADLINE_MS = 45_000;
/** A service that has no IPv6 address, so its answer is the exit's IPv4 one. */
const IPV4_ONLY_LOOKUP = 'https://api.ipify.org/?format=json';

/** The services of a lookup setting: one or more addresses separated by spaces. */
export function lookupServices(setting: string): string[] {
  return setting.split(/\s+/).filter((url) => url !== '');
}

function decodeChunked(body: Buffer): Buffer {
  const parts: Buffer[] = [];
  let at = 0;
  for (;;) {
    const lineEnd = body.indexOf('\r\n', at);
    if (lineEnd < 0) break;
    const size = parseInt(body.subarray(at, lineEnd).toString('latin1'), 16);
    if (!Number.isFinite(size) || size <= 0) break;
    parts.push(body.subarray(lineEnd + 2, lineEnd + 2 + size));
    at = lineEnd + 2 + size + 2;
  }
  return Buffer.concat(parts);
}

/** GETs `url` over a connection made through `proxy` and returns the response body. */
async function getThroughProxy(proxy: ProxySettings, url: URL): Promise<string> {
  const secure = url.protocol === 'https:';
  const port = Number(url.port) || (secure ? 443 : 80);
  const [tunnel, early] = await openTunnel(proxy, url.hostname, port);
  const socket: Socket = secure ? tlsConnect({ socket: tunnel, servername: url.hostname }) : tunnel;
  try {
    const chunks: Buffer[] = early.length > 0 && !secure ? [early] : [];
    let size = 0;
    const done = new Promise<void>((resolve, reject) => {
      socket.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > MAX_REPLY_BYTES) reject(new Error('the lookup reply is too large'));
        else chunks.push(chunk);
      });
      socket.on('end', resolve);
      socket.on('close', resolve);
      socket.on('error', reject);
      socket.setTimeout(LOOKUP_TIMEOUT_MS, () => reject(new Error('the lookup timed out')));
    });
    socket.write(`GET ${url.pathname}${url.search} HTTP/1.1\r\nHost: ${url.host}\r\n` +
                 'Accept: application/json\r\nUser-Agent: Mozilla/5.0\r\nConnection: close\r\n\r\n');
    await done;
    const reply = Buffer.concat(chunks);
    const headEnd = reply.indexOf('\r\n\r\n');
    if (headEnd < 0) throw new Error('the lookup service sent no reply');
    const head = reply.subarray(0, headEnd).toString('latin1');
    const status = Number(head.split(' ')[1]);
    if (status !== 200) throw new Error(`the lookup service answered ${status}`);
    const body = reply.subarray(headEnd + 4);
    return (/^transfer-encoding:\s*chunked/im.test(head) ? decodeChunked(body) : body).toString('utf8');
  } finally {
    socket.destroy();
    tunnel.destroy();
  }
}

/** Reads the address and time zone out of the JSON of the common lookup services. */
export function parseExit(json: string): ProxyExit {
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(json) as Record<string, unknown>;
  } catch {
    throw new Error('the lookup service did not answer with JSON');
  }
  const ip = [data.ip, data.query].find((value) => typeof value === 'string' && isIP(value) !== 0);
  if (typeof ip !== 'string') throw new Error('the lookup reply has no IP address');
  const zoneField = data.timezone;
  const zone = typeof zoneField === 'string' ? zoneField
      : typeof zoneField === 'object' && zoneField !== null ? (zoneField as Record<string, unknown>).id : '';
  let timezone = typeof zone === 'string' ? zone : '';
  try {
    if (timezone !== '') new Intl.DateTimeFormat('en-US', { timeZone: timezone });
  } catch {
    timezone = '';
  }
  const exit: ProxyExit = { ip, timezone };
  // Services name the field differently; one gives the two letters as "country".
  const country = [data.country_code, data.countryCode, data.country]
      .find((value) => typeof value === 'string' && /^[A-Za-z]{2}$/.test(value));
  if (typeof country === 'string') exit.country = country.toUpperCase();
  // Most services give two numbers; some give one "latitude,longitude" text.
  const pair = typeof data.loc === 'string' ? data.loc.split(',').map(Number) : [];
  const latitude = [data.latitude, data.lat, pair[0]].find((value) => typeof value === 'number' && Number.isFinite(value));
  const longitude = [data.longitude, data.lon, pair[1]].find((value) => typeof value === 'number' && Number.isFinite(value));
  if (typeof latitude === 'number' && typeof longitude === 'number' &&
      Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180 && (latitude !== 0 || longitude !== 0)) {
    exit.latitude = latitude;
    exit.longitude = longitude;
  }
  return exit;
}

/**
 * A position near the exit's city for this profile. Lookup services give one point
 * per city, which every user of the service would share exactly; a device reports
 * its own spot. The profile's seed picks a fixed spot a few kilometres away, with the
 * accuracy a desktop locating itself by Wi-Fi typically reports.
 */
function positionNear(latitude: number, longitude: number, seed: string): NonNullable<Profile['geolocation']> {
  let state = BigInt.asUintN(64, BigInt(seed) ^ 0x9e3779b97f4a7c15n);
  const next = (): number => {  // splitmix64, as a number in [0, 1)
    state = BigInt.asUintN(64, state + 0x9e3779b97f4a7c15n);
    let z = state;
    z = BigInt.asUintN(64, (z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n);
    z = BigInt.asUintN(64, (z ^ (z >> 27n)) * 0x94d049bb133111ebn);
    return Number((z ^ (z >> 31n)) >> 11n) / 2 ** 53;
  };
  const distanceKm = 0.5 + next() * 4.5, bearing = next() * 2 * Math.PI;
  const north = (distanceKm * Math.cos(bearing)) / 111.32;
  const east = (distanceKm * Math.sin(bearing)) / (111.32 * Math.max(0.2, Math.cos((latitude * Math.PI) / 180)));
  const round = (value: number): number => Math.round(value * 1e7) / 1e7;
  return {
    latitude: round(Math.max(-90, Math.min(90, latitude + north))),
    longitude: round(((longitude + east + 540) % 360) - 180),
    accuracy: Math.round(20 + next() * 130),
  };
}

/**
 * Asks each service of `services` in turn until one answers, and the whole list again
 * after a pause, as described at LOOKUP_ROUNDS. An answer without a time zone is kept
 * only if no service gives a better one in that round.
 */
async function firstAnswer(services: readonly string[], ask: (url: URL) => Promise<string>,
                           pauseMs: number): Promise<ProxyExit> {
  const urls = services.map((service) => new URL(service));
  if (urls.length === 0) throw new Error('no lookup service is set');
  for (const url of urls) {
    if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('the lookup URL must be http(s)');
  }
  const deadline = Date.now() + LOOKUP_DEADLINE_MS;
  let lastError = new Error('the lookup did not succeed');
  for (let round = 0; round < LOOKUP_ROUNDS && Date.now() < deadline; round++) {
    if (round > 0) await new Promise((resolve) => setTimeout(resolve, pauseMs));
    let addressOnly: ProxyExit | undefined;
    for (const url of urls) {
      if (Date.now() >= deadline) break;
      try {
        const exit = parseExit(await ask(url));
        if (exit.timezone !== '') return exit;
        addressOnly ??= exit;
      } catch (error) {
        lastError = error as Error;
        // Asking again will not change the proxy's mind about the login.
        if (/user name or password/.test(lastError.message)) throw lastError;
      }
    }
    if (addressOnly) return addressOnly;
  }
  throw lastError;
}

/**
 * Asks the lookup services directly which address this machine has from outside. Used
 * for a profile without a proxy, so that WebRTC can show the address sites see anyway.
 */
export async function lookupOwnAddress(lookupSetting: string): Promise<ProxyExit> {
  return firstAnswer(lookupServices(lookupSetting), async (url) => {
    const response = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS) });
    if (!response.ok) throw new Error(`the lookup service answered ${response.status}`);
    return response.text();
  }, 0);
}

/** Asks the lookup services, through `proxy`, what the proxy's exit looks like from outside. */
export async function lookupProxyExit(proxy: ProxySettings, lookupSetting: string,
                                      pauseMs: number = LOOKUP_PAUSE_MS): Promise<ProxyExit> {
  const exit = await firstAnswer(lookupServices(lookupSetting), (url) => getThroughProxy(proxy, url), pauseMs);
  // An exit with both kinds of address answered over IPv6. Its IPv4 address is the
  // one WebRTC needs, so ask a service that is only reachable over IPv4. Best effort.
  if (isIP(exit.ip) === 6) {
    try {
      const other = parseExit(await getThroughProxy(proxy, new URL(IPV4_ONLY_LOOKUP)));
      if (isIP(other.ip) === 4) exit.ipv4 = other.ip;
    } catch {
      // The exit has no IPv4 address, or it went away: WebRTC then shows no public address.
    }
  }
  return exit;
}

/**
 * The profile as it should run behind an exit: values the user set stay, empty ones
 * are filled in from the exit. WebRTC only takes IPv4, the form sites expect there.
 */
export function withOwnAddress(profile: Profile, own: ProxyExit): Profile {
  // Without a proxy the machine's own time zone and location are already the right
  // ones; only WebRTC needs to be told which address to show.
  return {
    ...profile,
    webrtcPublicIp: profile.webrtcPublicIp !== '' || isIP(own.ip) !== 4 ? profile.webrtcPublicIp : own.ip,
  };
}

/**
 * The same for a profile behind a proxy: values the user set stay, empty ones are
 * filled in from the exit.
 */
export function withProxyExit(profile: Profile, exit: ProxyExit): Profile {
  return {
    ...profile,
    timezone: profile.timezone !== '' ? profile.timezone : exit.timezone,
    // The languages of a browser set up in the exit's country, in that browser's order.
    languages: profile.languages.length > 0 || exit.country === undefined ? profile.languages
        : languagesOf(exit.country, profile.os),
    webrtcPublicIp: profile.webrtcPublicIp !== '' ? profile.webrtcPublicIp
        : isIP(exit.ip) === 4 ? exit.ip : exit.ipv4 ?? '',
    geolocation: profile.geolocation !== null || exit.latitude === undefined || exit.longitude === undefined
        ? profile.geolocation : positionNear(exit.latitude, exit.longitude, profile.seed),
  };
}

/** What a proxy looks like from outside, and how long it took to find out. */
export interface ProxyCheck extends ProxyExit {
  /** Milliseconds from asking to the answer, through the proxy. */
  ms: number;
}

/**
 * Tries `proxy`: goes through it to the lookup services and reports where it comes
 * out. Throws, with the reason, when it cannot be used.
 */
export async function checkProxy(proxy: ProxySettings, lookupSetting: string): Promise<ProxyCheck> {
  if (lookupServices(lookupSetting).length === 0) {
    throw new Error('the exit lookup is turned off in the settings, so a proxy cannot be checked');
  }
  const started = Date.now();
  const exit = await lookupProxyExit(proxy, lookupSetting);
  return { ...exit, ms: Date.now() - started };
}

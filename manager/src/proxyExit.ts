// Finds out where a profile's proxy comes out, so the profile can match it.
//
// A site sees the proxy's exit address. If the browser then reports the machine's own
// time zone, or WebRTC shows no address or a different one, the mismatch gives the
// proxy away. Before a profile with a proxy starts, the manager therefore asks a
// lookup service, through that proxy, which address and time zone the exit has.

import { isIP, type Socket } from 'node:net';
import { connect as tlsConnect } from 'node:tls';

import type { Profile, ProxySettings } from './profile.ts';
import { openTunnel } from './proxyRelay.ts';

export interface ProxyExit {
  /** Address sites see. */
  ip: string;
  /** IANA time zone of that address, or '' when the service did not say. */
  timezone: string;
  /** Rough position of that address (its city), when the service gave one. */
  latitude?: number;
  longitude?: number;
}

const LOOKUP_TIMEOUT_MS = 15_000;
const MAX_REPLY_BYTES = 256 * 1024;

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
  const latitude = [data.latitude, data.lat].find((value) => typeof value === 'number');
  const longitude = [data.longitude, data.lon].find((value) => typeof value === 'number');
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
 * Asks `lookupUrl` directly which address this machine has from outside. Used for a
 * profile without a proxy, so that WebRTC can show the address sites see anyway.
 */
export async function lookupOwnAddress(lookupUrl: string): Promise<ProxyExit> {
  const response = await fetch(lookupUrl, {
    headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`the lookup service answered ${response.status}`);
  return parseExit(await response.text());
}

/** Asks `lookupUrl`, through `proxy`, what the proxy's exit looks like from outside. */
export async function lookupProxyExit(proxy: ProxySettings, lookupUrl: string): Promise<ProxyExit> {
  const url = new URL(lookupUrl);
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('the lookup URL must be http(s)');
  return parseExit(await getThroughProxy(proxy, url));
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
    webrtcPublicIp: profile.webrtcPublicIp !== '' || isIP(exit.ip) !== 4 ? profile.webrtcPublicIp : exit.ip,
    geolocation: profile.geolocation !== null || exit.latitude === undefined || exit.longitude === undefined
        ? profile.geolocation : positionNear(exit.latitude, exit.longitude, profile.seed),
  };
}

// What a browser sends before any page loads: the TLS ClientHello and the opening of
// its HTTP/2 connection. Servers recognise a browser by the shape of these as much as
// by its User-Agent, so a profile's claim and its shape must tell the same story.
//
// recordTransport() listens on a loopback port, lets one browser connect, and reports
// the shape it saw. Nothing leaves the machine: the recorder is the server.
//
// The TLS shape is given as a JA4 fingerprint (github.com/FoxIO-LLC/ja4, the "JA4"
// TLS client part) and the HTTP/2 shape in the form Akamai described
// (SETTINGS|WINDOW_UPDATE|PRIORITY|pseudo-header order), with the values they are
// computed from beside them.

import { createHash, generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import { performServerHandshake, type ServerHttp2Session } from 'node:http2';
import { createServer, type Server, type Socket } from 'node:net';
import { Duplex } from 'node:stream';
import { createSecureContext, type SecureContext, TLSSocket } from 'node:tls';

export interface TlsShape {
  /** The JA4 fingerprint, e.g. t13d1516h2_8daaf6152771_d8a2da3f94cd. */
  ja4: string;
  /** Highest TLS version offered: "1.3", "1.2", ... */
  version: string;
  /** Cipher suites in the order offered, as four hex digits each. GREASE values left out, as everywhere below. */
  ciphers: string[];
  /** Extension types, sorted (Chrome sends them in a new order on every connection). */
  extensions: string[];
  signatureAlgorithms: string[];
  /** supported_groups, in the order offered. */
  groups: string[];
  /** The groups a key share was sent for. */
  keyShares: string[];
  alpn: string[];
  /** Whether a server name was sent. */
  serverName: boolean;
  /** Whether GREASE values were mixed in, as Chrome does. */
  grease: boolean;
  /** Whether the hello offered to resume an earlier session (a pre_shared_key extension), which adds one extension. */
  resumption: boolean;
}

export interface Http2Shape {
  /** SETTINGS|WINDOW_UPDATE|PRIORITY|pseudo-header order, e.g. 1:65536;2:0;4:6291456;6:262144|15663105|0|m,a,s,p */
  fingerprint: string;
  /** The first SETTINGS frame: [identifier, value] in the order sent. */
  settings: [number, number][];
  /** The connection window increment sent after it, or 0. */
  windowUpdate: number;
  /** Priority on the first request's HEADERS frame, if it carried one. */
  headersPriority: { weight: number; dependsOn: number; exclusive: boolean } | null;
  /** PRIORITY frames sent before the first request: "stream:exclusive:dependsOn:weight" each. */
  priorityFrames: string[];
  /** The first request's pseudo-headers in the order sent, e.g. [":method", ":authority", ":scheme", ":path"]. */
  pseudoHeaders: string[];
  /** The first request's other header names in the order sent. */
  headers: string[];
}

export interface TransportShape {
  tls: TlsShape;
  /** Null when the browser did not go on to speak HTTP/2. */
  http2: Http2Shape | null;
  /** The User-Agent of the first request, if there was one. */
  userAgent: string | null;
}

export class TransportError extends Error {}

const hex4 = (n: number) => n.toString(16).padStart(4, '0');
/** RFC 8701: 0x0a0a, 0x1a1a, ... reserved values a client mixes in at random. */
const isGrease = (n: number) => (n & 0x0f0f) === 0x0a0a && (n >> 8) === (n & 0xff);
const hash12 = (text: string) => createHash('sha256').update(text).digest('hex').slice(0, 12);

const TLS_VERSIONS: Record<number, string> = { 0x0304: '1.3', 0x0303: '1.2', 0x0302: '1.1', 0x0301: '1.0' };

/**
 * The ClientHello at the start of `bytes` (TLS records as received), or null while
 * more bytes are needed. Throws when the bytes are not a ClientHello.
 */
export function parseClientHello(bytes: Buffer): TlsShape | null {
  // A hello may be split over several handshake records: join their payloads.
  const parts: Buffer[] = [];
  let have = 0;
  let need = -1;
  for (let at = 0; need < 0 || have < need; ) {
    if (bytes.length < at + 5) return null;
    if (bytes[at] !== 22) throw new TransportError('the connection did not open with a TLS handshake');
    const length = bytes.readUInt16BE(at + 3);
    if (bytes.length < at + 5 + length) return null;
    parts.push(bytes.subarray(at + 5, at + 5 + length));
    have += length;
    at += 5 + length;
    if (need < 0 && have >= 4) {
      const head = Buffer.concat(parts);
      if (head[0] !== 1) throw new TransportError('the first TLS message was not a ClientHello');
      need = 4 + head.readUIntBE(1, 3);
    }
  }
  const hello = Buffer.concat(parts).subarray(4, need);
  let at = 2 + 32; // legacy_version, random
  const legacyVersion = hello.readUInt16BE(0);
  at += 1 + hello[at]; // session id
  const cipherBytes = hello.readUInt16BE(at);
  at += 2;
  const everyCipher: number[] = [];
  for (let i = 0; i < cipherBytes; i += 2) everyCipher.push(hello.readUInt16BE(at + i));
  at += cipherBytes;
  at += 1 + hello[at]; // compression methods
  const extensionTypes: number[] = [];
  const bodies = new Map<number, Buffer>();
  if (at < hello.length) {
    const end = at + 2 + hello.readUInt16BE(at);
    at += 2;
    while (at + 4 <= end) {
      const type = hello.readUInt16BE(at);
      const length = hello.readUInt16BE(at + 2);
      extensionTypes.push(type);
      bodies.set(type, hello.subarray(at + 4, at + 4 + length));
      at += 4 + length;
    }
  }
  /** A list of 16-bit values preceded by its length in `prefix` bytes. */
  const list16 = (body: Buffer | undefined, prefix: 1 | 2): number[] => {
    if (!body || body.length < prefix) return [];
    const values: number[] = [];
    for (let i = prefix; i + 2 <= body.length; i += 2) values.push(body.readUInt16BE(i));
    return values;
  };
  const alpn: string[] = [];
  const alpnBody = bodies.get(16);
  if (alpnBody) {
    for (let i = 2; i < alpnBody.length; i += 1 + alpnBody[i]) {
      alpn.push(alpnBody.subarray(i + 1, i + 1 + alpnBody[i]).toString('latin1'));
    }
  }
  const keyShares: number[] = [];
  const shareBody = bodies.get(51);
  if (shareBody) {
    for (let i = 2; i + 4 <= shareBody.length; i += 4 + shareBody.readUInt16BE(i + 2)) keyShares.push(shareBody.readUInt16BE(i));
  }
  const versions = list16(bodies.get(43), 1).filter((v) => !isGrease(v));
  const highest = versions.length > 0 ? Math.max(...versions) : legacyVersion;
  const ciphers = everyCipher.filter((c) => !isGrease(c));
  const extensions = extensionTypes.filter((e) => !isGrease(e));
  const signatureAlgorithms = list16(bodies.get(13), 2).filter((a) => !isGrease(a)).map(hex4);
  const serverName = bodies.has(0);

  // JA4: protocol, version, SNI, counts, first ALPN; the sorted ciphers; the sorted
  // extensions without SNI and ALPN, then the signature algorithms in their own order.
  const first = alpn[0] ?? '';
  const alnum = (c: string) => /^[0-9a-z]$/i.test(c);
  const alpnMark = first === '' ? '00'
      : alnum(first[0]) && alnum(first[first.length - 1]) ? first[0] + first[first.length - 1]
      : Buffer.from(first, 'latin1').toString('hex').replace(/^(.).*(.)$/, '$1$2');
  const two = (n: number) => String(Math.min(n, 99)).padStart(2, '0');
  const versionMark = ({ '1.3': '13', '1.2': '12', '1.1': '11', '1.0': '10' } as Record<string, string>)[TLS_VERSIONS[highest] ?? ''] ?? '00';
  const sortedCiphers = ciphers.map(hex4).sort();
  const hashedExtensions = extensions.filter((e) => e !== 0 && e !== 16).map(hex4).sort();
  const ja4 = `t${versionMark}${serverName ? 'd' : 'i'}${two(ciphers.length)}${two(extensions.length)}${alpnMark}_` +
      `${sortedCiphers.length > 0 ? hash12(sortedCiphers.join(',')) : '000000000000'}_` +
      `${hashedExtensions.length > 0 ? hash12(hashedExtensions.join(',') + (signatureAlgorithms.length > 0 ? '_' + signatureAlgorithms.join(',') : '')) : '000000000000'}`;

  return {
    ja4,
    version: TLS_VERSIONS[highest] ?? hex4(highest),
    ciphers: ciphers.map(hex4),
    extensions: extensions.map(hex4).sort(),
    signatureAlgorithms,
    groups: list16(bodies.get(10), 2).filter((g) => !isGrease(g)).map(hex4),
    keyShares: keyShares.filter((g) => !isGrease(g)).map(hex4),
    alpn,
    serverName,
    grease: everyCipher.some(isGrease) || extensionTypes.some(isGrease),
    resumption: bodies.has(41),
  };
}

const PREFACE = Buffer.from('PRI * HTTP/2.0\r\n\r\nSM\r\n\r\n', 'latin1');

/** What the frames a client opens an HTTP/2 connection with say, up to its first request. */
export interface Http2Opening {
  settings: [number, number][];
  windowUpdate: number;
  headersPriority: Http2Shape['headersPriority'];
  priorityFrames: string[];
  /** True once the first HEADERS frame was seen: the opening is complete. */
  complete: boolean;
}

/** Reads the opening of an HTTP/2 connection from the bytes a client sent (decrypted). */
export function parseHttp2Opening(bytes: Buffer): Http2Opening {
  const opening: Http2Opening = { settings: [], windowUpdate: 0, headersPriority: null, priorityFrames: [], complete: false };
  if (bytes.length < PREFACE.length || !bytes.subarray(0, PREFACE.length).equals(PREFACE)) return opening;
  let sawSettings = false;
  for (let at = PREFACE.length; at + 9 <= bytes.length; ) {
    const length = bytes.readUIntBE(at, 3);
    const type = bytes[at + 3];
    const flags = bytes[at + 4];
    const stream = bytes.readUInt32BE(at + 5) & 0x7fffffff;
    const body = bytes.subarray(at + 9, at + 9 + length);
    if (body.length < length) break;
    at += 9 + length;
    const priority = (from: Buffer) => ({
      weight: from[4] + 1, dependsOn: from.readUInt32BE(0) & 0x7fffffff, exclusive: (from[0] & 0x80) !== 0,
    });
    if (type === 4 && (flags & 1) === 0 && !sawSettings) {
      sawSettings = true;
      for (let i = 0; i + 6 <= body.length; i += 6) opening.settings.push([body.readUInt16BE(i), body.readUInt32BE(i + 2)]);
    } else if (type === 8 && stream === 0 && opening.windowUpdate === 0 && body.length >= 4) {
      opening.windowUpdate = body.readUInt32BE(0) & 0x7fffffff;
    } else if (type === 2 && body.length >= 5) {
      const p = priority(body);
      opening.priorityFrames.push(`${stream}:${p.exclusive ? 1 : 0}:${p.dependsOn}:${p.weight}`);
    } else if (type === 1) {
      // PADDED (0x8) puts a length byte first; PRIORITY (0x20) then five bytes of priority.
      const start = (flags & 0x08) !== 0 ? 1 : 0;
      if ((flags & 0x20) !== 0 && body.length >= start + 5) opening.headersPriority = priority(body.subarray(start));
      opening.complete = true;
      break;
    }
  }
  return opening;
}

/** The Akamai-style fingerprint of an opening and the first request's pseudo-header order. */
export function http2Fingerprint(opening: Http2Opening, pseudoHeaders: readonly string[]): string {
  return [
    opening.settings.map(([id, value]) => `${id}:${value}`).join(';'),
    opening.windowUpdate === 0 ? '00' : String(opening.windowUpdate),
    opening.priorityFrames.length > 0 ? opening.priorityFrames.join(',') : '0',
    pseudoHeaders.map((name) => name[1]).join(','),
  ].join('|');
}

// --- A certificate for the recorder ----------------------------------------------
// Made fresh for every recording and never stored. The browser being measured is
// told to accept it (it is started for the measurement alone, in a folder of its
// own), so it only has to be well-formed.

function der(tag: number, ...parts: Buffer[]): Buffer {
  const body = Buffer.concat(parts);
  const length = body.length < 0x80 ? Buffer.from([body.length])
      : body.length < 0x100 ? Buffer.from([0x81, body.length])
      : Buffer.from([0x82, body.length >> 8, body.length & 0xff]);
  return Buffer.concat([Buffer.from([tag]), length, body]);
}

/** A self-signed certificate for "localhost" and its key, as PEM. */
export function selfSignedCertificate(): { key: string; cert: string } {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const ecdsaSha256 = der(0x30, Buffer.from('06082a8648ce3d040302', 'hex'));
  const name = der(0x30, der(0x31, der(0x30, Buffer.from('0603550403', 'hex'), der(0x0c, Buffer.from('localhost')))));
  const time = (date: Date) => der(0x17, Buffer.from(date.toISOString().replace(/[-:T]/g, '').slice(2, 14) + 'Z'));
  const serial = randomBytes(8);
  serial[0] &= 0x7f;
  serial[0] |= 0x01;
  const now = Date.now();
  const names = der(0x30, der(0x82, Buffer.from('localhost')), der(0x87, Buffer.from([127, 0, 0, 1])));
  const tbs = der(0x30,
      der(0xa0, der(0x02, Buffer.from([2]))),
      der(0x02, serial),
      ecdsaSha256,
      name,
      der(0x30, time(new Date(now - 86_400_000)), time(new Date(now + 7 * 86_400_000))),
      name,
      publicKey.export({ type: 'spki', format: 'der' }),
      der(0xa3, der(0x30, der(0x30, Buffer.from('0603551d11', 'hex'), der(0x04, names)))));
  const signature = sign('sha256', tbs, privateKey);
  const certificate = der(0x30, tbs, ecdsaSha256, der(0x03, Buffer.from([0]), signature));
  const lines = certificate.toString('base64').match(/.{1,64}/g) ?? [];
  return {
    key: privateKey.export({ type: 'pkcs8', format: 'pem' }) as string,
    cert: `-----BEGIN CERTIFICATE-----\n${lines.join('\n')}\n-----END CERTIFICATE-----\n`,
  };
}

// --- The recorder ----------------------------------------------------------------

/** `inner` as a stream of its own, with everything read from it also given to `seen`. */
function tapped(inner: Duplex, seen: (chunk: Buffer) => void): Duplex {
  const outer = new Duplex({
    read() {
      inner.resume();
    },
    write(chunk: Buffer, _encoding, done) {
      if (inner.destroyed || inner.writableEnded) return done();
      inner.write(chunk, (error) => done(error ?? undefined));
    },
    final(done) {
      if (!inner.destroyed && !inner.writableEnded) inner.end();
      done();
    },
    destroy(error, done) {
      inner.destroy();
      done(error);
    },
  });
  inner.on('data', (chunk: Buffer) => {
    seen(chunk);
    if (!outer.push(chunk)) inner.pause();
  });
  inner.on('end', () => outer.push(null));
  inner.on('error', () => outer.destroy());
  inner.on('close', () => outer.destroy());
  return outer;
}

export interface Recorder {
  /** The address to send the browser to: https://localhost:<port>/ */
  url: string;
  /** The shape of the first connection that gets as far as a request, or of its hello alone if none does in time. */
  shape: Promise<TransportShape>;
  close(): Promise<void>;
}

const AFTER_HELLO_MS = 4_000;
const MAX_OPENING_BYTES = 64 * 1024;

/**
 * Starts a recorder. `timeoutMs` is how long it waits for a browser to connect at
 * all (`shape` rejects with a TransportError after that), `afterHelloMs` how long a
 * hello waits for the rest of its connection before it is reported alone.
 */
export async function startRecorder(timeoutMs = 30_000, afterHelloMs = AFTER_HELLO_MS): Promise<Recorder> {
  const { key, cert } = selfSignedCertificate();
  const context: SecureContext = createSecureContext({ key, cert });
  const sockets = new Set<Socket>();
  const sessions = new Set<ServerHttp2Session>();
  let settle: (shape: TransportShape) => void = () => {};
  let fail: (error: Error) => void = () => {};
  let settled = false;
  const shape = new Promise<TransportShape>((resolve, reject) => {
    settle = (value) => {
      if (!settled) resolve(value);
      settled = true;
    };
    fail = (error) => {
      if (!settled) reject(error);
      settled = true;
    };
  });
  shape.catch(() => {});
  const timers: NodeJS.Timeout[] = [];
  timers.push(setTimeout(() => fail(new TransportError('no browser connected to the recorder in time')), timeoutMs));

  const server: Server = createServer((socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => {});
    let raw = Buffer.alloc(0);
    let tls: TlsShape | null = null;
    let clear = Buffer.alloc(0);
    const encrypted = tapped(socket, (chunk) => {
      if (tls !== null || raw.length > MAX_OPENING_BYTES) return;
      raw = Buffer.concat([raw, chunk]);
      try {
        tls = parseClientHello(raw);
      } catch {
        socket.destroy();
        return;
      }
      if (tls !== null) {
        // A browser that does not go on (it refused the certificate, say) is still
        // reported by its hello.
        const alone = tls;
        timers.push(setTimeout(() => settle({ tls: alone, http2: null, userAgent: null }), afterHelloMs));
      }
    });
    const secure = new TLSSocket(encrypted, { isServer: true, secureContext: context, ALPNProtocols: ['h2'] });
    secure.on('error', () => socket.destroy());
    const plain = tapped(secure, (chunk) => {
      if (clear.length < MAX_OPENING_BYTES) clear = Buffer.concat([clear, chunk]);
    });
    plain.on('error', () => {});
    const session = performServerHandshake(plain);
    sessions.add(session);
    session.on('close', () => sessions.delete(session));
    session.on('error', () => {});
    session.on('stream', (stream, headers, _flags, rawHeaders) => {
      stream.on('error', () => {});
      const names = (rawHeaders as string[]).filter((_, i) => i % 2 === 0);
      const opening = parseHttp2Opening(clear);
      const pseudoHeaders = names.filter((name) => name.startsWith(':'));
      if (tls !== null) {
        settle({
          tls,
          http2: {
            fingerprint: http2Fingerprint(opening, pseudoHeaders),
            settings: opening.settings,
            windowUpdate: opening.windowUpdate,
            headersPriority: opening.headersPriority,
            priorityFrames: opening.priorityFrames,
            pseudoHeaders,
            headers: names.filter((name) => !name.startsWith(':')),
          },
          userAgent: typeof headers['user-agent'] === 'string' ? headers['user-agent'] : null,
        });
      }
      stream.respond({ ':status': 200, 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
      stream.end('recorded\n');
    });
  });
  server.on('error', (error) => fail(error));
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const { port } = server.address() as { port: number };
  return {
    url: `https://localhost:${port}/`,
    shape,
    async close() {
      for (const timer of timers) clearTimeout(timer);
      fail(new TransportError('the recorder was closed'));
      for (const session of sessions) session.destroy();
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

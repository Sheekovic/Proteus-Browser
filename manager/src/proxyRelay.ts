// A loopback SOCKS5 server that forwards every connection through an upstream proxy
// that needs a user name and password.
//
// Chromium cannot be given proxy credentials on its command line (it would show a
// login prompt instead), so a profile with an authenticated proxy points its kernel
// at one of these relays, which logs in to the real proxy on its behalf. Host names
// are passed on unresolved, so DNS lookups happen at the proxy, not on this machine.

import { createServer, connect, type Server, type Socket } from 'node:net';

import type { ProxySettings } from './profile.ts';

const HANDSHAKE_TIMEOUT_MS = 30_000;

/** Reads exact byte counts, or up to a delimiter, from a socket. */
class Reader {
  private readonly socket: Socket;
  private buffer: Buffer = Buffer.alloc(0);
  private wake: (() => void) | null = null;
  private ended = false;
  private readonly onData = (chunk: Buffer): void => {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    this.wake?.();
  };
  private readonly onEnd = (): void => {
    this.ended = true;
    this.wake?.();
  };

  constructor(socket: Socket) {
    this.socket = socket;
    socket.on('data', this.onData);
    socket.on('end', this.onEnd);
    socket.on('close', this.onEnd);
    socket.on('error', this.onEnd);
  }

  private async more(): Promise<void> {
    if (this.ended) throw new Error('connection closed during the handshake');
    await new Promise<void>((resolve) => { this.wake = resolve; });
    this.wake = null;
  }

  async bytes(count: number): Promise<Buffer> {
    while (this.buffer.length < count) await this.more();
    const out = this.buffer.subarray(0, count);
    this.buffer = this.buffer.subarray(count);
    return out;
  }

  async until(delimiter: string, limit: number): Promise<string> {
    for (;;) {
      const at = this.buffer.indexOf(delimiter);
      if (at >= 0) {
        const out = this.buffer.subarray(0, at + delimiter.length).toString('latin1');
        this.buffer = this.buffer.subarray(at + delimiter.length);
        return out;
      }
      if (this.buffer.length > limit) throw new Error('reply too long');
      await this.more();
    }
  }

  /** Stops reading and returns whatever arrived after the handshake. */
  release(): Buffer {
    this.socket.off('data', this.onData);
    this.socket.off('end', this.onEnd);
    this.socket.off('close', this.onEnd);
    this.socket.off('error', this.onEnd);
    return this.buffer;
  }
}

function openSocket(host: string, port: number): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = connect({ host, port });
    socket.once('connect', () => { socket.off('error', reject); resolve(socket); });
    socket.once('error', reject);
  });
}

/** Opens a tunnel to host:port through an HTTP proxy, using CONNECT. */
async function throughHttp(proxy: ProxySettings, host: string, port: number): Promise<[Socket, Buffer]> {
  const socket = await openSocket(proxy.host, proxy.port);
  const target = host.includes(':') ? `[${host}]:${port}` : `${host}:${port}`;
  const credentials = Buffer.from(`${proxy.username ?? ''}:${proxy.password ?? ''}`).toString('base64');
  const login = (proxy.username ?? '') === '' ? '' : `Proxy-Authorization: Basic ${credentials}\r\n`;
  socket.write(`CONNECT ${target} HTTP/1.1\r\nHost: ${target}\r\n${login}\r\n`);
  const reader = new Reader(socket);
  const head = await reader.until('\r\n\r\n', 16_384);
  const status = Number(head.split(' ')[1]);
  if (status !== 200) {
    socket.destroy();
    throw new Error(status === 407 ? 'the proxy rejected the user name or password'
                                   : `the proxy answered ${status || 'with something unexpected'}`);
  }
  return [socket, reader.release()];
}

/** Opens a tunnel to host:port through a SOCKS5 proxy with user name and password. */
async function throughSocks5(proxy: ProxySettings, host: string, port: number): Promise<[Socket, Buffer]> {
  const socket = await openSocket(proxy.host, proxy.port);
  const reader = new Reader(socket);
  try {
    socket.write(Buffer.from([5, 2, 0, 2]));  // Offer "no login" and "user name/password".
    const [, method] = await reader.bytes(2);
    if (method === 2) {
      const user = Buffer.from(proxy.username ?? ''), pass = Buffer.from(proxy.password ?? '');
      socket.write(Buffer.concat([Buffer.from([1, user.length]), user, Buffer.from([pass.length]), pass]));
      const [, result] = await reader.bytes(2);
      if (result !== 0) throw new Error('the proxy rejected the user name or password');
    } else if (method !== 0) {
      throw new Error('the proxy accepts no login method this relay supports');
    }
    const name = Buffer.from(host);
    socket.write(Buffer.concat([Buffer.from([5, 1, 0, 3, name.length]), name,
                                Buffer.from([port >> 8, port & 0xff])]));
    const [, reply, , addressType] = await reader.bytes(4);
    if (reply !== 0) throw new Error(`the proxy could not connect (SOCKS reply ${reply})`);
    const addressLength = addressType === 1 ? 4 : addressType === 4 ? 16 : (await reader.bytes(1))[0];
    await reader.bytes(addressLength + 2);
    return [socket, reader.release()];
  } catch (error) {
    socket.destroy();
    throw error;
  }
}

/**
 * Opens a connection to host:port through `proxy`, logging in if it has credentials.
 * Returns the socket and any bytes the far end sent before the tunnel was handed over.
 */
export function openTunnel(proxy: ProxySettings, host: string, port: number): Promise<[Socket, Buffer]> {
  return (proxy.type === 'socks5' ? throughSocks5 : throughHttp)(proxy, host, port);
}

/** Serves one SOCKS5 client: reads where it wants to go, then joins it to the upstream. */
async function serve(client: Socket, upstream: ProxySettings): Promise<void> {
  const reader = new Reader(client);
  const [version, methodCount] = await reader.bytes(2);
  if (version !== 5) throw new Error('not a SOCKS5 client');
  await reader.bytes(methodCount);
  client.write(Buffer.from([5, 0]));

  const [, command, , addressType] = await reader.bytes(4);
  let host: string;
  if (addressType === 3) {
    host = (await reader.bytes((await reader.bytes(1))[0])).toString('latin1');
  } else if (addressType === 1) {
    host = [...await reader.bytes(4)].join('.');
  } else if (addressType === 4) {
    host = (await reader.bytes(16)).toString('hex').match(/.{4}/g)!.join(':');
  } else {
    throw new Error('unknown address type');
  }
  const port = (await reader.bytes(2)).readUInt16BE(0);
  if (command !== 1) {  // Only CONNECT; no UDP, so WebRTC cannot go around the proxy.
    client.end(Buffer.from([5, 7, 0, 1, 0, 0, 0, 0, 0, 0]));
    return;
  }

  let remote: Socket, early: Buffer;
  try {
    [remote, early] = await openTunnel(upstream, host, port);
  } catch {
    client.end(Buffer.from([5, 5, 0, 1, 0, 0, 0, 0, 0, 0]));
    return;
  }
  client.write(Buffer.from([5, 0, 0, 1, 0, 0, 0, 0, 0, 0]));
  const pending = reader.release();
  if (pending.length > 0) remote.write(pending);
  if (early.length > 0) client.write(early);
  client.pipe(remote);
  remote.pipe(client);
  const close = (): void => { client.destroy(); remote.destroy(); };
  client.on('error', close);
  remote.on('error', close);
  client.on('close', close);
  remote.on('close', close);
}

export interface ProxyRelay {
  /** Loopback port the kernel should use as a SOCKS5 proxy. */
  port: number;
  close(): Promise<void>;
}

/** Starts a relay for `upstream` on a free loopback port. */
export function startProxyRelay(upstream: ProxySettings): Promise<ProxyRelay> {
  const sockets = new Set<Socket>();
  const server: Server = createServer((client) => {
    sockets.add(client);
    client.on('close', () => sockets.delete(client));
    client.setTimeout(HANDSHAKE_TIMEOUT_MS, () => client.destroy());
    serve(client, upstream).then(() => client.setTimeout(0), () => client.destroy());
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (address === null || typeof address === 'string') return reject(new Error('no relay port'));
      resolve({
        port: address.port,
        close: () => new Promise<void>((done) => {
          for (const socket of sockets) socket.destroy();
          server.close(() => done());
        }),
      });
    });
  });
}

/** Whether `proxy` needs a relay, i.e. has credentials the kernel cannot be given. */
export function needsRelay(proxy: ProxySettings | null): proxy is ProxySettings {
  return proxy !== null && (proxy.username ?? '') !== '';
}

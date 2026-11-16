// The proxy relay: a kernel pointed at it reaches its target through an upstream
// proxy that demands a login, without ever being given the login itself.
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer, connect, type Server, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';

import { buildKernelArgs, buildKernelConfig } from '../src/kernelConfig.ts';
import { ValidationError } from '../src/profile.ts';
import { needsRelay, startProxyRelay } from '../src/proxyRelay.ts';
import { Store } from '../src/store.ts';

const USER = 'alice', PASS = 'p@ss word';
const servers: Server[] = [];
let echoPort = 0, httpProxyPort = 0, socksProxyPort = 0;
/** What each fake upstream proxy was asked to connect to. */
const seen: string[] = [];

function listen(handler: (socket: Socket) => void): Promise<number> {
  const server = createServer((socket) => { socket.on('error', () => {}); handler(socket); });
  servers.push(server);
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => {
    resolve((server.address() as { port: number }).port);
  }));
}

before(async () => {
  // The "website": answers every line with "echo:<line>".
  echoPort = await listen((socket) => socket.on('data', (data) => socket.write(`echo:${data}`)));

  // An HTTP proxy that only tunnels for the right Basic credentials.
  httpProxyPort = await listen((socket) => {
    socket.once('data', (data) => {
      const head = data.toString('latin1');
      const target = /^CONNECT (\S+)/.exec(head)?.[1] ?? '';
      const given = /Proxy-Authorization: Basic (\S+)/i.exec(head)?.[1] ?? '';
      if (Buffer.from(given, 'base64').toString() !== `${USER}:${PASS}`) {
        socket.end('HTTP/1.1 407 Proxy Authentication Required\r\n\r\n');
        return;
      }
      seen.push(`http ${target}`);
      const remote = connect(Number(target.split(':').pop()), '127.0.0.1', () => {
        socket.write('HTTP/1.1 200 Connection established\r\n\r\n');
        socket.pipe(remote); remote.pipe(socket);
      });
      remote.on('error', () => socket.destroy());
    });
  });

  // A SOCKS5 proxy that insists on user name/password login.
  socksProxyPort = await listen((socket) => {
    let stage = 0;
    const onData = (data: Buffer): void => {
      if (stage === 0) {
        stage = 1;
        socket.write(Buffer.from([5, data.subarray(2).includes(2) ? 2 : 0xff]));
      } else if (stage === 1) {
        const userLength = data[1], user = data.subarray(2, 2 + userLength).toString();
        const pass = data.subarray(3 + userLength, 3 + userLength + data[2 + userLength]).toString();
        const ok = user === USER && pass === PASS;
        stage = 2;
        socket.write(Buffer.from([1, ok ? 0 : 1]));
        if (!ok) socket.end();
      } else {
        const host = data.subarray(5, 5 + data[4]).toString();
        const port = data.readUInt16BE(5 + data[4]);
        seen.push(`socks5 ${host}:${port}`);
        socket.off('data', onData);
        const remote = connect(port, '127.0.0.1', () => {
          socket.write(Buffer.from([5, 0, 0, 1, 127, 0, 0, 1, 0, 0]));
          socket.pipe(remote); remote.pipe(socket);
        });
        remote.on('error', () => socket.destroy());
      }
    };
    socket.on('data', onData);
  });
});

after(() => { for (const server of servers) server.close(); });

/** A minimal SOCKS5 client, as the kernel would be: asks the relay for host:port. */
async function viaRelay(relayPort: number, host: string, port: number, message: string): Promise<string> {
  const socket = connect(relayPort, '127.0.0.1');
  socket.on('error', () => {});
  await once(socket, 'connect');
  const next = async (): Promise<Buffer> => {
    const result = await Promise.race([once(socket, 'data'), once(socket, 'close').then(() => null)]);
    if (result === null) throw new Error('closed');
    return result[0] as Buffer;
  };
  socket.write(Buffer.from([5, 1, 0]));
  assert.deepEqual([...await next()], [5, 0]);
  const name = Buffer.from(host);
  socket.write(Buffer.concat([Buffer.from([5, 1, 0, 3, name.length]), name, Buffer.from([port >> 8, port & 0xff])]));
  const reply = await next();
  if (reply[1] !== 0) { socket.destroy(); return `refused:${reply[1]}`; }
  socket.write(message);
  const answer = (await next()).toString();
  socket.destroy();
  return answer;
}

for (const type of ['http', 'socks5'] as const) {
  test(`relay logs in to an upstream ${type} proxy`, async () => {
    const port = type === 'http' ? httpProxyPort : socksProxyPort;
    const relay = await startProxyRelay({ type, host: '127.0.0.1', port, username: USER, password: PASS });
    try {
      seen.length = 0;
      assert.equal(await viaRelay(relay.port, 'localhost', echoPort, 'hello'), 'echo:hello');
      // The host name reaches the proxy unresolved, so DNS happens there.
      assert.deepEqual(seen, [`${type} localhost:${echoPort}`]);
    } finally {
      await relay.close();
    }
  });

  test(`relay reports failure for a wrong ${type} proxy password`, async () => {
    const port = type === 'http' ? httpProxyPort : socksProxyPort;
    const relay = await startProxyRelay({ type, host: '127.0.0.1', port, username: USER, password: 'wrong' });
    try {
      seen.length = 0;
      assert.equal(await viaRelay(relay.port, 'localhost', echoPort, 'hello'), 'refused:5');
      assert.deepEqual(seen, []);
    } finally {
      await relay.close();
    }
  });
}

test('a relay is used only for proxies with a login, and hides it from the kernel', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'proteus-proxy-test-'));
  try {
    const store = new Store(dataDir);
    const open = await store.createProfile({ proxy: { type: 'http', host: '10.0.0.5', port: 8080 } });
    assert.equal(needsRelay(open.proxy), false);
    assert.equal(needsRelay(null), false);

    const locked = await store.createProfile({
      proxy: { type: 'http', host: '10.0.0.5', port: 8080, username: USER, password: PASS },
    });
    assert.equal(needsRelay(locked.proxy), true);
    const paths = { userDataDir: '/d', configFile: '/c', proxyServer: 'socks5://127.0.0.1:4444' };
    const args = buildKernelArgs(locked, paths, []);
    assert.ok(args.includes('--proxy-server=socks5://127.0.0.1:4444'));
    assert.ok(!args.join(' ').includes(USER) && !args.join(' ').includes('10.0.0.5'),
              'neither the login nor the real proxy appears on the command line');

    for (const proxy of [
      { type: 'http', host: 'h', port: 1, username: 'a:b', password: 'x' },
      { type: 'http', host: 'h', port: 1, password: 'x' },
      { type: 'http', host: 'h', port: 1, username: 'a\r\nX: y', password: 'x' },
      { type: 'http', host: 'h', port: 1, username: 'a', password: 'x'.repeat(300) },
    ]) {
      await assert.rejects(store.createProfile({ proxy } as never), ValidationError, JSON.stringify(proxy));
    }
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test('a start contacts nobody on its own', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'proteus-proxy-test-'));
  try {
    const profile = await new Store(dataDir).createProfile({});
    const args = buildKernelArgs(profile, { userDataDir: '/d', configFile: '/c' }, []);
    assert.ok(args.includes('--disable-background-networking'));
    assert.ok(args.includes('--disable-component-update'));
    assert.equal(args.at(-1), 'about:blank', 'no start page means a blank one, not the new-tab page');
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

// --- Matching the proxy's exit --------------------------------------------------

import { spawn } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { createServer as createHttpServer } from 'node:http';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Launcher, LaunchError } from '../src/launcher.ts';
import { lookupProxyExit, parseExit, withProxyExit } from '../src/proxyExit.ts';

const EXIT = { ip: '203.0.113.50', timezone: { id: 'Asia/Tokyo' }, success: true };

/** A stand-in lookup service; counts how often it is asked. */
async function lookupService(reply: unknown = EXIT): Promise<{ url: string; hits: () => number; close: () => void }> {
  let hits = 0;
  const server = createHttpServer((_request, response) => {
    hits++;
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify(reply));  // Sent chunked, as real services do.
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as { port: number };
  return { url: `http://127.0.0.1:${port}/json`, hits: () => hits, close: () => server.close() };
}

for (const type of ['http', 'socks5'] as const) {
  test(`the exit of an upstream ${type} proxy is looked up through it`, async () => {
    const service = await lookupService();
    try {
      seen.length = 0;
      const proxy = { type, host: '127.0.0.1', port: type === 'http' ? httpProxyPort : socksProxyPort,
                      username: USER, password: PASS };
      assert.deepEqual(await lookupProxyExit(proxy, service.url), { ip: '203.0.113.50', timezone: 'Asia/Tokyo' });
      assert.equal(seen.length, 1, 'the request went through the proxy');
      await assert.rejects(lookupProxyExit({ ...proxy, password: 'wrong' }, service.url));
    } finally {
      service.close();
    }
  });
}

test('lookup replies of the common services are understood, bad ones refused', () => {
  assert.deepEqual(parseExit('{"query":"198.51.100.4","timezone":"Europe/Paris"}'),
                   { ip: '198.51.100.4', timezone: 'Europe/Paris' });
  assert.deepEqual(parseExit('{"ip":"2001:db8::1","timezone":{"id":"No/Such_Zone"}}'),
                   { ip: '2001:db8::1', timezone: '' });
  assert.throws(() => parseExit('<html>blocked</html>'));
  assert.throws(() => parseExit('{"ip":"not an address"}'));
});

test('values the user set win over the exit; WebRTC takes IPv4 only', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'proteus-proxy-test-'));
  try {
    const store = new Store(dataDir);
    const blank = await store.createProfile({});
    const exit = { ip: '203.0.113.50', timezone: 'Asia/Tokyo' };
    assert.equal(withProxyExit(blank, exit).timezone, 'Asia/Tokyo');
    assert.equal(withProxyExit(blank, exit).webrtcPublicIp, '203.0.113.50');
    const set = await store.createProfile({ timezone: 'Europe/Berlin', webrtcPublicIp: '198.51.100.9' });
    assert.equal(withProxyExit(set, exit).timezone, 'Europe/Berlin');
    assert.equal(withProxyExit(set, exit).webrtcPublicIp, '198.51.100.9');
    assert.equal(withProxyExit(blank, { ip: '2001:db8::1', timezone: '' }).webrtcPublicIp, '');
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test('a start matches the profile to its proxy exit, or refuses to start', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'proteus-proxy-test-'));
  const stub = join(dirname(fileURLToPath(import.meta.url)), 'stub-kernel.mjs');
  const store = new Store(dataDir);
  const launcher = new Launcher(store, (_path, args) => spawn(process.execPath, [stub, ...args], { stdio: 'ignore' }));
  const service = await lookupService();
  try {
    await writeFile(join(dataDir, 'kernel-placeholder'), '');
    await store.updateSettings({ kernelPath: join(dataDir, 'kernel-placeholder'), exitLookupUrl: service.url });
    const proxy = { type: 'http' as const, host: '127.0.0.1', port: httpProxyPort, username: USER, password: PASS };

    const profile = await store.createProfile({ proxy });
    assert.equal(profile.matchProxy, true, 'new profiles match their proxy');
    const status = await launcher.start(profile);
    assert.deepEqual(status.proxyExit, { ip: '203.0.113.50', timezone: 'Asia/Tokyo' });
    const config = JSON.parse(await readFile(join(store.profileDir(profile.id), 'kernel.json'), 'utf8'));
    assert.equal(config.timezone, 'Asia/Tokyo');
    assert.equal(config.webRtcPublicIp, '203.0.113.50');
    assert.equal((await store.getProfile(profile.id)).timezone, '', 'the stored profile is not rewritten');
    await launcher.stop(profile.id);

    // A proxy that cannot be used must not lead to a browser with the wrong time zone.
    const broken = await store.createProfile({ proxy: { ...proxy, password: 'wrong' } });
    await assert.rejects(launcher.start(broken), LaunchError);
    assert.equal(launcher.isRunning(broken.id), false);

    // Opting out starts without asking anyone.
    const before = service.hits();
    const optedOut = await store.createProfile({ proxy, matchProxy: false });
    assert.equal((await launcher.start(optedOut)).proxyExit, undefined);
    assert.equal(service.hits(), before);
    // Without a proxy the lookup tells which address sites see anyway, for WebRTC only.
    const direct = await store.createProfile({});
    assert.equal((await launcher.start(direct)).proxyExit, undefined);
    assert.equal(service.hits(), before + 1);
    const directConfig = JSON.parse(await readFile(join(store.profileDir(direct.id), 'kernel.json'), 'utf8'));
    assert.equal(directConfig.webRtcPublicIp, '203.0.113.50');
    assert.ok(!('timezone' in directConfig), 'the machine keeps its own time zone');
    // Opted out, nobody is asked.
    await launcher.start(await store.createProfile({ matchProxy: false }));
    assert.equal(service.hits(), before + 1);
  } finally {
    await launcher.stopAll();
    service.close();
    await rm(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});

test('the position follows the proxy exit: near its city, fixed per profile', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'proteus-proxy-test-'));
  try {
    const store = new Store(dataDir);
    const exit = parseExit('{"ip":"203.0.113.50","timezone":{"id":"Europe/Berlin"},"latitude":52.52,"longitude":13.405}');
    assert.equal(exit.latitude, 52.52);
    const a = await store.createProfile({}), b = await store.createProfile({});
    const placeA = withProxyExit(a, exit).geolocation!, placeB = withProxyExit(b, exit).geolocation!;
    const km = (p: { latitude: number; longitude: number }): number =>
        Math.hypot((p.latitude - 52.52) * 111.32, (p.longitude - 13.405) * 111.32 * Math.cos(52.52 * Math.PI / 180));
    for (const place of [placeA, placeB]) {
      assert.ok(km(place) >= 0.4 && km(place) <= 5.1, `within the city, not its centre point (${km(place)} km)`);
      assert.ok(place.accuracy >= 20 && place.accuracy <= 150);
    }
    assert.notDeepEqual(placeA, placeB, 'two profiles behind one exit are not at the same spot');
    assert.deepEqual(withProxyExit(a, exit).geolocation, placeA, 'a profile stays where it is');

    const fixed = await store.createProfile({ geolocation: { latitude: 1, longitude: 2, accuracy: 30 } });
    assert.deepEqual(withProxyExit(fixed, exit).geolocation, { latitude: 1, longitude: 2, accuracy: 30 });
    assert.equal(withProxyExit(a, { ip: '203.0.113.50', timezone: '' }).geolocation, null);
    assert.deepEqual(buildKernelConfig(fixed).geolocation, { latitude: 1, longitude: 2, accuracy: 30 });
    assert.ok(!('geolocation' in buildKernelConfig(a)));
    await assert.rejects(store.createProfile({ geolocation: { latitude: 91, longitude: 0, accuracy: 30 } }), ValidationError);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

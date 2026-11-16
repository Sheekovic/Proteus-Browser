// What a real proxy taught: exits that refuse one moment and serve the next, services
// an exit cannot reach, proxies that take a connection and say nothing, and exits
// that answer with an IPv6 address.

import assert from 'node:assert/strict';
import { createServer as createHttpServer } from 'node:http';
import { createServer, connect, type Server } from 'node:net';
import { after, before, test } from 'node:test';

import { lookupProxyExit, lookupServices, parseExit, withProxyExit } from '../src/proxyExit.ts';
import type { Profile } from '../src/profile.ts';
import { setTunnelTimeoutForTests } from '../src/proxyRelay.ts';

const closers: (() => void)[] = [];
after(() => { for (const close of closers) close(); });

/** A lookup service that answers with `replies` in turn (a number is an HTTP error status). */
async function service(replies: (number | object)[]): Promise<{ url: string; hits: () => number }> {
  let hits = 0;
  const server = createHttpServer((_request, response) => {
    const reply = replies[Math.min(hits, replies.length - 1)];
    hits++;
    if (typeof reply === 'number') {
      response.statusCode = reply;
      response.end();
    } else {
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify(reply));
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  closers.push(() => server.close());
  return { url: `http://127.0.0.1:${(server.address() as { port: number }).port}/json`, hits: () => hits };
}

let proxyPort = 0, silentPort = 0;
before(async () => {
  const listen = (server: Server): Promise<number> => new Promise((resolve) => server.listen(0, '127.0.0.1', () => {
    closers.push(() => server.close());
    resolve((server.address() as { port: number }).port);
  }));
  // An HTTP proxy without a login that tunnels to wherever it is asked.
  proxyPort = await listen(createServer((socket) => {
    socket.on('error', () => {});
    socket.once('data', (data) => {
      const target = /^CONNECT (\S+)/.exec(data.toString('latin1'))?.[1] ?? '';
      const remote = connect(Number(target.split(':').pop()), '127.0.0.1', () => {
        socket.write('HTTP/1.1 200 Connection established\r\n\r\n');
        socket.pipe(remote); remote.pipe(socket);
      });
      remote.on('error', () => socket.destroy());
    });
  }));
  // A proxy that accepts the connection and then says nothing, like an exit that has gone away.
  const held: unknown[] = [];
  silentPort = await listen(createServer((socket) => { socket.on('error', () => {}); held.push(socket); }));
});

const proxy = () => ({ type: 'http' as const, host: '127.0.0.1', port: proxyPort });
const GOOD = { ip: '203.0.113.50', timezone: 'Asia/Tokyo', latitude: 35.6, longitude: 139.7 };

test('a lookup setting holds one service or several', () => {
  assert.deepEqual(lookupServices('https://a.example/x'), ['https://a.example/x']);
  assert.deepEqual(lookupServices('  https://a.example/ \n https://b.example/json  '), ['https://a.example/', 'https://b.example/json']);
  assert.deepEqual(lookupServices(''), []);
});

test('a service the exit cannot reach is passed over for the next one', async () => {
  const blocked = await service([503]);
  const fine = await service([GOOD]);
  const exit = await lookupProxyExit(proxy(), `${blocked.url} ${fine.url}`, 10);
  assert.deepEqual(exit, { ip: '203.0.113.50', timezone: 'Asia/Tokyo', latitude: 35.6, longitude: 139.7 });
  assert.equal(blocked.hits(), 1, 'asked once, then left alone');
});

test('an exit that refuses at first is asked again', async () => {
  const flaky = await service([503, 503, GOOD]);
  const exit = await lookupProxyExit(proxy(), flaky.url, 10);
  assert.equal(exit.ip, '203.0.113.50');
  assert.equal(flaky.hits(), 3);
  // Not for ever: three rounds, then the start is refused with the reason.
  const dead = await service([503]);
  await assert.rejects(lookupProxyExit(proxy(), dead.url, 10), /answered 503/);
  assert.equal(dead.hits(), 3);
});

test('an answer with a time zone is preferred to one without', async () => {
  const bare = await service([{ ip: '203.0.113.9' }]);
  const full = await service([GOOD]);
  assert.equal((await lookupProxyExit(proxy(), `${bare.url} ${full.url}`, 10)).timezone, 'Asia/Tokyo');
  // Alone, the address is still worth having.
  assert.deepEqual(await lookupProxyExit(proxy(), bare.url, 10), { ip: '203.0.113.9', timezone: '' });
});

test('a proxy that takes the connection and says nothing does not hang the start', async () => {
  setTunnelTimeoutForTests(250);
  try {
    const fine = await service([GOOD]);
    const started = Date.now();
    await assert.rejects(lookupProxyExit({ type: 'http', host: '127.0.0.1', port: silentPort }, fine.url, 10),
                         /did not answer in time/);
    assert.ok(Date.now() - started < 5000, `gave up after ${Date.now() - started} ms`);
    assert.equal(fine.hits(), 0);
  } finally {
    setTunnelTimeoutForTests(12_000);
  }
});

test('a wrong login is not asked about three times', async () => {
  const strict = await new Promise<number>((resolve) => {
    const server = createServer((socket) => {
      socket.on('error', () => {});
      socket.once('data', () => socket.end('HTTP/1.1 407 Proxy Authentication Required\r\n\r\n'));
    });
    server.listen(0, '127.0.0.1', () => { closers.push(() => server.close()); resolve((server.address() as { port: number }).port); });
  });
  const fine = await service([GOOD]);
  const started = Date.now();
  await assert.rejects(lookupProxyExit({ type: 'http', host: '127.0.0.1', port: strict, username: 'u', password: 'bad' },
                                       `${fine.url} ${fine.url}`, 2000), /user name or password/);
  assert.ok(Date.now() - started < 1500, 'no second round');
});

test('positions come as two numbers or as one text', () => {
  assert.deepEqual(parseExit('{"ip":"198.51.100.4","timezone":"Europe/Paris","loc":"48.8534,2.3488"}'),
                   { ip: '198.51.100.4', timezone: 'Europe/Paris', latitude: 48.8534, longitude: 2.3488 });
  assert.deepEqual(parseExit('{"ip":"198.51.100.4","timezone":"Europe/Paris","loc":"nonsense"}'),
                   { ip: '198.51.100.4', timezone: 'Europe/Paris' });
});

test('WebRTC shows the IPv4 address of an exit that answered over IPv6', () => {
  const blank = { timezone: '', webrtcPublicIp: '', geolocation: null, seed: '7' } as Profile;
  assert.equal(withProxyExit(blank, { ip: '2001:db8::1', timezone: 'America/Los_Angeles', ipv4: '203.0.113.50' }).webrtcPublicIp, '203.0.113.50');
  assert.equal(withProxyExit(blank, { ip: '2001:db8::1', timezone: 'America/Los_Angeles' }).webrtcPublicIp, '', 'none, rather than an IPv6 one');
  assert.equal(withProxyExit(blank, { ip: '203.0.113.50', timezone: '' }).webrtcPublicIp, '203.0.113.50');
  assert.equal(withProxyExit({ ...blank, webrtcPublicIp: '198.51.100.1' }, { ip: '203.0.113.50', timezone: '' }).webrtcPublicIp,
               '198.51.100.1', 'what the user set stays');
});

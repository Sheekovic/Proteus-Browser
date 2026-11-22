// End-to-end check of the manager against a real Proteus kernel.
//
// Starts the manager, creates a profile through the API, launches the kernel for it,
// then asks the running browser (over its DevTools endpoint) what a web page actually
// sees and compares that with the profile. Finally stops and deletes the profile.
//
// usage: node real-kernel.mjs <kernel executable> <test pages base URL> [extra kernel args...]
//   e.g. node real-kernel.mjs /opt/proteus/chromium/src/out/Linux/chrome http://127.0.0.1:8791 \
//          --headless=new --no-sandbox --disable-gpu
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer as createHttpServer } from 'node:http';
import { connect as netConnect, createServer as createNetServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const [kernelPath, pagesUrl, ...extraArgs] = process.argv.slice(2);
if (!kernelPath || !pagesUrl) {
  console.error('usage: real-kernel.mjs <kernel executable> <test pages base URL> [extra kernel args...]');
  process.exit(2);
}

const managerDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const dataDir = mkdtempSync(join(tmpdir(), 'proteus-e2e-'));
const PORT = 5311;
const base = `http://127.0.0.1:${PORT}`;
// Documentation-only addresses (RFC 5737): the public address the profile claims, and
// a STUN server that does not exist. The kernel must never contact the latter.
const PUBLIC_IP = '203.0.113.7';
const STUN = '192.0.2.1:3478';
// Software WebGPU adapter, for machines without a GPU.
// On Windows the machine's own GPU is used instead.
const WEBGPU_ARGS = process.platform === 'win32' ? ['--enable-unsafe-webgpu'] :
    ['--enable-unsafe-webgpu', '--use-webgpu-adapter=swiftshader', '--use-angle=swiftshader',
     '--enable-unsafe-swiftshader', '--enable-features=Vulkan'];

let failures = 0;
function check(name, actual, expected) {
  if (actual === expected) {
    console.log(`ok   ${name}`);
  } else {
    console.log(`FAIL ${name}\n       got:      ${actual}\n       expected: ${expected}`);
    failures++;
  }
}
function differ(name, actual, other) {
  if (actual !== other) console.log(`ok   ${name}`);
  else { console.log(`FAIL ${name} (both ${actual})`); failures++; }
}

async function api(method, path, body) {
  const response = await fetch(base + path, {
    method,
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : undefined;
  if (!response.ok) throw new Error(`${method} ${path} -> ${response.status}: ${text}`);
  return data;
}

/** Opens `url` in a new tab of the running kernel and returns what `expression` gives there. */
async function evaluateIn(debuggerUrl, url, expression) {
  const tab = await (await fetch(`${debuggerUrl}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' })).json();
  await delay(1500);
  const socket = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', () => reject(new Error('could not connect to the tab')), { once: true });
  });
  const reply = await new Promise((resolve) => {
    socket.addEventListener('message', (event) => resolve(JSON.parse(event.data)), { once: true });
    socket.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression, returnByValue: true } }));
  });
  socket.close();
  return reply.result?.result?.value;
}

/** Opens `url` in a new tab of the running kernel and returns the fields of its RESULT line. */
async function readPage(debuggerUrl, url) {
  const tab = await (await fetch(`${debuggerUrl}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' })).json();
  const socket = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', () => reject(new Error('could not connect to the tab')), { once: true });
  });
  const expression = `new Promise((resolve, reject) => {
    const started = Date.now();
    const timer = setInterval(() => {
      const text = document.body ? document.body.innerText : '';
      if (text.startsWith('RESULT')) { clearInterval(timer); resolve(text); }
      else if (Date.now() - started > 15000) { clearInterval(timer); reject(new Error('no RESULT: ' + text)); }
    }, 100);
  })`;
  let lastReply;
  const send = (id, method, params) => new Promise((resolve) => {
    const onMessage = (event) => {
      const message = JSON.parse(event.data);
      if (message.id !== id) return;
      socket.removeEventListener('message', onMessage);
      resolve(message);
    };
    socket.addEventListener('message', onMessage);
    socket.send(JSON.stringify({ id, method, params }));
  });
  try {
    // No waiting here on purpose: the manager must hand out an endpoint that is
    // ready for a tab the moment start() returns.
    for (let attempt = 0; attempt < 10; attempt++) {
      const reply = await new Promise((resolve) => {
        socket.addEventListener('message', (event) => resolve(JSON.parse(event.data)), { once: true });
        socket.send(JSON.stringify({
          id: attempt + 1, method: 'Runtime.evaluate',
          params: { expression, awaitPromise: true, returnByValue: true },
        }));
      });
      lastReply = reply;
      const value = reply.result?.result?.value;
      if (typeof value === 'string') {
        const fields = {};
        for (const part of value.replace(/^RESULT\s+/, '').split(/\s+/)) {
          const at = part.indexOf('=');
          if (at > 0) fields[part.slice(0, at)] = decodeURIComponent(part.slice(at + 1));
        }
        return fields;
      }
      await delay(500);  // The page was still navigating; ask again.
    }
    throw new Error(`could not read ${url}: ${JSON.stringify(lastReply).slice(0, 400)}`);
  } finally {
    socket.close();
    await fetch(`${debuggerUrl}/json/close/${tab.id}`).catch(() => {});
  }
}

/**
 * Sends one command to the browser itself (not a tab) over DevTools and returns the
 * connection, still open: what a command grants lasts only as long as its connection.
 */
async function browserCommand(debuggerUrl, method, params) {
  const version = await (await fetch(`${debuggerUrl}/json/version`)).json();
  const socket = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', () => reject(new Error('could not connect to the browser')), { once: true });
  });
  const reply = await new Promise((resolve) => {
    socket.addEventListener('message', (event) => resolve(JSON.parse(event.data)), { once: true });
    socket.send(JSON.stringify({ id: 1, method, params }));
  });
  if (reply.error) {
    socket.close();
    throw new Error(`${method}: ${reply.error.message}`);
  }
  return socket;
}

/**
 * Whether the tab the kernel opened by itself at start shows a test page's RESULT
 * line within 20 seconds. (Every other check opens its own tab, later; a kernel
 * whose first page never loads would pass them all.)
 */
async function firstTabLoaded(debuggerUrl) {
  const targets = await (await fetch(`${debuggerUrl}/json/list`)).json();
  const page = targets.find((target) => target.type === 'page');
  if (!page) return false;
  const socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', () => reject(new Error('could not connect to the first tab')), { once: true });
  });
  try {
    for (let attempt = 0; attempt < 40; attempt++) {
      const reply = await new Promise((resolve) => {
        socket.addEventListener('message', (event) => resolve(JSON.parse(event.data)), { once: true });
        socket.send(JSON.stringify({
          id: attempt + 1, method: 'Runtime.evaluate',
          params: { expression: `!!document.body && document.body.innerText.startsWith('RESULT')`, returnByValue: true },
        }));
      });
      if (reply.result?.result?.value === true) return true;
      await delay(500);
    }
    return false;
  } finally {
    socket.close();
  }
}

function isAlive(pid) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

const manager = spawn(process.execPath, [join(managerDir, 'src', 'main.ts'), '--port', String(PORT)], {
  env: { ...process.env, PROTEUS_HOME: dataDir },
  stdio: ['ignore', 'inherit', 'inherit'],
});

try {
  for (let i = 0; i < 50; i++) {
    try { await api('GET', '/api/health'); break; } catch { await delay(100); }
  }
  // No lookup service until the proxy part below brings its own: the run stays offline.
  await api('PUT', '/api/settings', { kernelPath, extraArgs, exitLookupUrl: '' });

  const profile = await api('POST', '/api/profiles', {
    name: 'End-to-end', os: 'windows', languages: ['de-DE', 'de', 'en'], timezone: 'Europe/Berlin',
    webrtcPublicIp: PUBLIC_IP, startUrl: `${pagesUrl}/audio.html`,
  });
  console.log(`profile: ${profile.userAgent}`);
  console.log(`         ${profile.screen.width}x${profile.screen.height}, ${profile.hardwareConcurrency} cores, ` +
              `${profile.deviceMemory} GB, seed ${profile.seed}`);

  const status = await api('POST', `/api/profiles/${profile.id}/start`);
  check('profile reports running', status.state, 'running');
  check('a DevTools endpoint is reported', typeof status.debuggerUrl, 'string');

  const version = await (await fetch(`${status.debuggerUrl}/json/version`)).json();
  check('DevTools endpoint answers with the profile user agent', version['User-Agent'], profile.userAgent);

  check('the start page loads in the first tab', await firstTabLoaded(status.debuggerUrl), true);

  // Driving the browser through the manager's own API and its MCP endpoint.
  const tab = await api('POST', `/api/profiles/${profile.id}/tabs`, { url: `${pagesUrl}/canvas.html` });
  await delay(1500);
  const seen = await api('GET', `/api/profiles/${profile.id}/tabs/${tab.id}/text`);
  check('API: a tab opened through the API shows the page', seen.text.startsWith('RESULT'), true);
  const answer = await api('POST', `/api/profiles/${profile.id}/tabs/${tab.id}/evaluate`, { expression: 'navigator.userAgent' });
  check('API: a script runs in the page and sees the profile', answer.value, profile.userAgent);
  const picture = await fetch(`${base}/api/profiles/${profile.id}/tabs/${tab.id}/screenshot`);
  const pictureBytes = new Uint8Array(await picture.arrayBuffer());
  check('API: a screenshot is a PNG', picture.headers.get('content-type') === 'image/png' && pictureBytes.length > 1000 &&
        String.fromCharCode(...pictureBytes.slice(1, 4)) === 'PNG', true);
  await api('PUT', `/api/profiles/${profile.id}/cookies`,
            [{ name: 'e2e', value: 'kept', domain: '127.0.0.1', path: '/' }]);
  const cookies = await api('GET', `/api/profiles/${profile.id}/cookies`);
  check('API: a cookie that was set is there', cookies.some((c) => c.name === 'e2e' && c.value === 'kept'), true);
  const viaMcp = await api('POST', '/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/call',
                                             params: { name: 'page_text', arguments: { id: profile.id, tabId: tab.id } } });
  check('MCP: page_text reads the same tab', JSON.parse(viaMcp.result.content[0].text).text.startsWith('RESULT'), true);
  await fetch(`${base}/api/profiles/${profile.id}/tabs/${tab.id}`, { method: 'DELETE' });

  const identity = await readPage(status.debuggerUrl, `${pagesUrl}/identity.html`);
  check('navigator.userAgent', identity.ua, profile.userAgent);
  check('navigator.platform', identity.platform, profile.platform);
  check('client hints platform', identity.chPlatform, profile.uaData.platform);
  check('client hints platform version', identity.chPlatformVersion, profile.uaData.platformVersion);
  const major = profile.uaData.fullVersion.split('.')[0];
  const brands = identity.chBrands.split(',');
  check('client hints list has three brands', brands.length, 3);
  check('client hints include the profile brand', brands.includes(`${profile.uaData.brand}/${major}`), true);
  check('client hints include Chromium', brands.includes(`Chromium/${major}`), true);
  check('User-Agent header seen by the server', identity.hdrUa, profile.userAgent);
  check('worker navigator.platform', identity.workerPlatform, profile.platform);

  const locale = await readPage(status.debuggerUrl, `${pagesUrl}/locale.html`);
  check('screen size', locale.screen, `${profile.screen.width}x${profile.screen.height}`);
  check('available screen size', locale.avail,
        `${profile.screen.availWidth}x${profile.screen.availHeight}@0,0`);
  check('navigator.languages', locale.languages, 'de-DE,de,en');
  check('Accept-Language header', locale.hdrLanguage, 'de-DE,de;q=0.9,en;q=0.8');
  check('time zone', locale.zone, 'Europe/Berlin');
  check('UTC offsets winter/summer', locale.offsets, '-60/-120');

  const canvas = await readPage(status.debuggerUrl, `${pagesUrl}/canvas.html`);
  check('canvas reads are stable', canvas.stable, 'true');
  check('flat canvas untouched', canvas.flat, 'true');
  const audio = await readPage(status.debuggerUrl, `${pagesUrl}/audio.html`);
  check('audio renders are stable', audio.stable, 'true');

  const voices = await readPage(status.debuggerUrl, `${pagesUrl}/voices.html`);
  differ('the generated profile has voices', profile.voices.length, 0);
  check('speech voice count', voices.voices, String(profile.voices.length));
  check('speech voice names', voices.voiceNames,
        profile.voices.slice(0, 6).map((v) => v.name + (v.local ? '' : '*')).join('|'));
  check('speech voice details', voices.voiceDetail, profile.voices.slice(0, 4).map(
      (v) => [v.name, v.lang, v.local, v.default === true, v.name].join('~')).join('|'));

  const rtc = await readPage(status.debuggerUrl,
                             `${pagesUrl}/webrtc.html?stun=${STUN}&expect=${PUBLIC_IP}`);
  check('WebRTC shows one host and one public candidate', rtc.types, 'host:1,srflx:1');
  check('WebRTC host candidate is an mDNS name', rtc.mdns, '1');
  check('WebRTC public candidate is the profile address', rtc.srflxIsExpected, 'true');
  check('WebRTC shows no other address', rtc.ipLiterals, '1');

  // A second profile must look like a different device.
  const other = await api('POST', '/api/profiles', { name: 'Second', os: 'windows' });
  const otherStatus = await api('POST', `/api/profiles/${other.id}/start`);
  const otherCanvas = await readPage(otherStatus.debuggerUrl, `${pagesUrl}/canvas.html`);
  const otherAudio = await readPage(otherStatus.debuggerUrl, `${pagesUrl}/audio.html`);
  differ('two profiles have different canvas fingerprints', canvas.data, otherCanvas.data);
  differ('two profiles have different audio fingerprints', audio.hash, otherAudio.hash);
  differ('two running profiles use different DevTools ports', status.debuggerUrl, otherStatus.debuggerUrl);

  // Restarting a profile keeps its fingerprint.
  await api('POST', `/api/profiles/${profile.id}/stop`);
  check('kernel process is gone after stop', isAlive(status.pid), false);
  const again = await api('POST', `/api/profiles/${profile.id}/start`);
  const canvasAgain = await readPage(again.debuggerUrl, `${pagesUrl}/canvas.html`);
  check('canvas fingerprint survives a restart', canvasAgain.data, canvas.data);

  const devices = await readPage(again.debuggerUrl, `${pagesUrl}/mediadev.html?list`);
  check('media devices: a microphone, a camera and speakers, nameless before permission',
        `${devices.kinds}/${devices.nameless}`, 'audioinput,videoinput,audiooutput/true');
  const power = await readPage(again.debuggerUrl, `${pagesUrl}/battery.html`);
  check('battery: a computer on its charger, whatever this machine is',
        `${power.charging}/${power.level}/${power.chargingTime}/${power.dischargingTime}`, 'true/1/0/Infinity');
  check('desktop Chrome does not name its connection', power.type, 'absent');

  // An iPhone profile is Safari on a phone, in script and in its requests.
  const iphone = await api('POST', '/api/profiles', { name: 'iPhone', os: 'ios', startUrl: `${pagesUrl}/canvas.html` });
  const iphoneStatus = await api('POST', `/api/profiles/${iphone.id}/start`);
  check('iPhone: the start page loads in the first tab', await firstTabLoaded(iphoneStatus.debuggerUrl), true);
  const foreign = await readPage(iphoneStatus.debuggerUrl, `${pagesUrl}/foreign.html`);
  check('iPhone: navigator.vendor', foreign.vendor, 'Apple Computer, Inc.');
  check('iPhone: user agent in requests', foreign.ua, iphone.userAgent);
  check('iPhone: none of the members Safari lacks', foreign.members, 'none');
  check('iPhone: nor in a worker', foreign.workerMembers, 'none');
  check('iPhone: no window.chrome', foreign.chrome, 'undefined');
  check('iPhone: no client hint request headers', foreign.hintHeaders, 'none');
  const phone = await readPage(iphoneStatus.debuggerUrl, `${pagesUrl}/mobile.html`);
  check('iPhone: screen', phone.screen, `${iphone.screen.width}x${iphone.screen.height}`);
  check('iPhone: page area', phone.inner, `${iphone.mobile.viewWidth}x${iphone.mobile.viewHeight}`);
  check('iPhone: pixel ratio', phone.dpr, '3');
  check('iPhone: touch', `${phone.touchPoints}/${phone.touchEvents}/${phone.coarse}`, '5/true/true');
  check('iPhone: platform', phone.platform, 'iPhone');
  const phoneDevices = await readPage(iphoneStatus.debuggerUrl, `${pagesUrl}/mediadev.html?list`);
  check('iPhone: a microphone and a camera, no speaker entry', phoneDevices.kinds, 'audioinput,videoinput');
  const phonePower = await readPage(iphoneStatus.debuggerUrl, `${pagesUrl}/battery.html`);
  check('iPhone: no battery or connection interface', `${phonePower.battery}/${phonePower.connection}`, 'absent/absent');
  // And on the wire: the handshake Safari on an iPhone was measured to make.
  const phoneTransport = await api('GET', `/api/profiles/${iphone.id}/transport`);
  check('iPhone: the TLS hello is Safari\'s', phoneTransport.produces.tls.ja4, 't13d2013h2_a09f3c656075_7f0f34a4126d');
  check('iPhone: the HTTP/2 opening is Safari\'s', phoneTransport.produces.http2?.fingerprint, '2:0;3:100;4:2097152;9:1|10420225|0|m,s,a,p');
  check('iPhone: handshake and claim agree', `${phoneTransport.agrees} ${phoneTransport.differences.join(' ')}`.trim(), 'true');
  // And in what the page finds: none of the interfaces Chrome has and Safari does not.
  const phoneSurface = await readPage(iphoneStatus.debuggerUrl, `${pagesUrl}/members.html`);
  check('iPhone: none of the interfaces only Chrome has', phoneSurface.globals, 'none');
  check('iPhone: no WebXR or WebUSB interface', `${phoneSurface.xr}/${phoneSurface.usb}`, '0/0');
  check('iPhone: its screen has no members for several screens', phoneSurface.screenKeys, 'none');
  check('iPhone: what Safari has is still there', phoneSurface.kept, 'XMLHttpRequest,URL,Element,fetch,EventTarget');
  await api('POST', `/api/profiles/${iphone.id}/stop`);
  await api('DELETE', `/api/profiles/${iphone.id}`);

  // WebGPU needs an adapter, so relaunch with a software one. If even the plain
  // kernel cannot provide it on this machine, say so instead of passing.
  await api('POST', `/api/profiles/${profile.id}/stop`);
  await api('PUT', '/api/settings', {
    kernelPath, extraArgs: [...extraArgs.filter((a) => a !== '--disable-gpu'), ...WEBGPU_ARGS],
  });
  const gpuRun = await api('POST', `/api/profiles/${profile.id}/start`);
  // The first adapter request in a fresh GPU process can outlast the page's own wait.
  let gpu = await readPage(gpuRun.debuggerUrl, `${pagesUrl}/voices.html`);
  for (let i = 0; i < 3 && gpu.webgpu === 'timeout'; i++) {
    gpu = await readPage(gpuRun.debuggerUrl, `${pagesUrl}/voices.html`);
  }
  if (gpu.webgpu.includes('|')) {
    check('WebGPU vendor and architecture', gpu.webgpu.split('|').slice(0, 2).join('|'),
          `${profile.webgpu.vendor}|${profile.webgpu.architecture}`);
  } else {
    console.log(`SKIP WebGPU adapter info: no adapter on this machine (${gpu.webgpu})`);
  }

  // A proxy that needs a login: the browser must get through it without being given
  // the login, and must take its time zone and WebRTC address from the proxy's exit.
  const tunnels = [];
  const proxy = createNetServer((socket) => {
    socket.on('error', () => {});
    socket.once('data', (data) => {
      const head = data.toString('latin1');
      const target = /^CONNECT (\S+)/.exec(head)?.[1] ?? '';
      const given = Buffer.from(/Proxy-Authorization: Basic (\S+)/i.exec(head)?.[1] ?? '', 'base64').toString();
      if (given !== 'e2e-user:e2e pass') return socket.end('HTTP/1.1 407 Proxy Authentication Required\r\n\r\n');
      tunnels.push(target);
      const [host, port] = [target.slice(0, target.lastIndexOf(':')), Number(target.slice(target.lastIndexOf(':') + 1))];
      const remote = netConnect(port, host, () => {
        socket.write('HTTP/1.1 200 Connection established\r\n\r\n');
        socket.pipe(remote); remote.pipe(socket);
      });
      remote.on('error', () => socket.destroy());
    });
  });
  await new Promise((resolve) => proxy.listen(0, '127.0.0.1', resolve));
  const lookup = createHttpServer((_request, response) => {
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({ ip: PUBLIC_IP, timezone: { id: 'Asia/Tokyo' } }));
  });
  await new Promise((resolve) => lookup.listen(0, '127.0.0.1', resolve));
  try {
    await api('PUT', '/api/settings', {
      kernelPath, exitLookupUrl: `http://127.0.0.1:${lookup.address().port}/`,
      // Loopback normally bypasses a proxy; the test pages live there.
      extraArgs: [...extraArgs, '--proxy-bypass-list=<-loopback>'],
    });
    const proxied = await api('POST', '/api/profiles', {
      name: 'Proxied', os: 'windows', geolocation: { latitude: 35.6895, longitude: 139.6917, accuracy: 40 },
      proxy: { type: 'http', host: '127.0.0.1', port: proxy.address().port, username: 'e2e-user', password: 'e2e pass' },
    });
    const proxiedRun = await api('POST', `/api/profiles/${proxied.id}/start`);
    check('proxy exit is reported for the run', proxiedRun.proxyExit?.ip, PUBLIC_IP);
    tunnels.length = 0;
    const proxiedLocale = await readPage(proxiedRun.debuggerUrl, `${pagesUrl}/locale.html`);
    check('pages load through the proxy that needs a login',
          tunnels.includes(new URL(pagesUrl).host), true);
    check('time zone follows the proxy exit', proxiedLocale.zone, 'Asia/Tokyo');
    const proxiedRtc = await readPage(proxiedRun.debuggerUrl,
                                      `${pagesUrl}/webrtc.html?stun=${STUN}&expect=${PUBLIC_IP}`);
    check('WebRTC address follows the proxy exit', proxiedRtc.srflxIsExpected, 'true');
    // A site the user allowed gets the profile's position, not the machine's.
    const grant = await browserCommand(proxiedRun.debuggerUrl, 'Browser.grantPermissions',
                                       { origin: new URL(pagesUrl).origin, permissions: ['geolocation'] });
    const geo = await readPage(proxiedRun.debuggerUrl, `${pagesUrl}/geo.html?expect=35.6895,139.6917`);
    grant.close();
    check('geolocation is the profile position', `${geo.state}/${geo.matches}/${geo.accuracy}`, 'ok/true/40');
    const stoppedProxied = await api('POST', `/api/profiles/${proxied.id}/stop`);
    check('proxied profile stops', stoppedProxied.state, 'stopped');
    await api('DELETE', `/api/profiles/${proxied.id}`);
  } finally {
    proxy.close();
    lookup.close();
  }

  // The handshake: measured while the profile runs, and agreeing with what it claims.
  const transport = await api('GET', `/api/profiles/${profile.id}/transport`);
  check('transport: the profile claims the kernel\'s Chrome', `${transport.claims.browser} ${transport.claims.version}`,
        `Chrome ${transport.kernel.version}`);
  check('transport: the TLS hello is stock Chrome\'s', transport.produces.tls.ja4, transport.expected.ja4);
  check('transport: the HTTP/2 opening is stock Chrome\'s', transport.produces.http2?.fingerprint, transport.expected.http2);
  check('transport: the request carried the profile\'s User-Agent', transport.produces.userAgent, profile.userAgent);
  check('transport: handshake and claim agree', `${transport.agrees} ${transport.differences.join(' ')}`.trim(), 'true');
  check('transport: measuring left the profile running', (await api('GET', `/api/profiles/${profile.id}`)).state, 'running');

  // A computer's Chrome keeps everything the kernel has, and has one screen whatever
  // this machine has plugged in.
  const running = await api('GET', `/api/profiles/${profile.id}/status`);
  const surface = await readPage(running.debuggerUrl, `${pagesUrl}/members.html`);
  check('surface: a computer profile keeps the interfaces of Chrome', surface.globals,
        'EyeDropper,showOpenFilePicker,getScreenDetails,IdleDetector,documentPictureInPicture');
  check('surface: one screen', surface.extended, 'false');

  // Chrome on a phone: not what a computer's keyboard, screens and windows bring, and
  // the two interfaces only a phone has.
  const android = await api('POST', '/api/profiles', { name: 'Android', os: 'android' });
  const androidStatus = await api('POST', `/api/profiles/${android.id}/start`);
  const androidSurface = await readPage(androidStatus.debuggerUrl, `${pagesUrl}/members.html`);
  check('Android: no colour picker, screens list or always-on-top window', androidSurface.globals, 'showOpenFilePicker,IdleDetector');
  check('Android: it is still Chrome (WebUSB is there)', androidSurface.usb !== '0', true);
  check('Android: its screen has no members for several screens', androidSurface.screenKeys, 'none');
  const androidOnly = await evaluateIn(androidStatus.debuggerUrl, `${pagesUrl}/members.html`,
      `['contacts' in navigator, 'NDEFReader' in window, 'keyboard' in navigator, 'hid' in navigator].join()`);
  check('Android: contacts and NFC, no keyboard map or HID', androidOnly, 'true,true,false,false');
  await api('POST', `/api/profiles/${android.id}/stop`);
  await api('DELETE', `/api/profiles/${android.id}`);

  for (const id of [profile.id, other.id]) {
    const stopped = await api('POST', `/api/profiles/${id}/stop`);
    check('profile reports stopped', stopped.state, 'stopped');
    await api('DELETE', `/api/profiles/${id}`);
  }
  check('all profiles deleted', (await api('GET', '/api/profiles')).length, 0);
} catch (error) {
  console.log(`FAIL ${error.stack ?? error}`);
  failures++;
} finally {
  manager.kill('SIGTERM');
  await delay(1500);
  rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}

console.log(failures === 0 ? 'E2E-OK' : `E2E-FAIL (${failures})`);
process.exit(failures === 0 ? 0 : 1);

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
const WEBGPU_ARGS = ['--enable-unsafe-webgpu', '--use-webgpu-adapter=swiftshader', '--use-angle=swiftshader',
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
  try {
    for (let attempt = 0; attempt < 5; attempt++) {
      const reply = await new Promise((resolve) => {
        socket.addEventListener('message', (event) => resolve(JSON.parse(event.data)), { once: true });
        socket.send(JSON.stringify({
          id: attempt + 1, method: 'Runtime.evaluate',
          params: { expression, awaitPromise: true, returnByValue: true },
        }));
      });
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
    throw new Error(`could not read ${url}`);
  } finally {
    socket.close();
    await fetch(`${debuggerUrl}/json/close/${tab.id}`).catch(() => {});
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
  await api('PUT', '/api/settings', { kernelPath, extraArgs });

  const profile = await api('POST', '/api/profiles', {
    name: 'End-to-end', os: 'windows', languages: ['de-DE', 'de', 'en'], timezone: 'Europe/Berlin',
    webrtcPublicIp: PUBLIC_IP,
  });
  console.log(`profile: ${profile.userAgent}`);
  console.log(`         ${profile.screen.width}x${profile.screen.height}, ${profile.hardwareConcurrency} cores, ` +
              `${profile.deviceMemory} GB, seed ${profile.seed}`);

  const status = await api('POST', `/api/profiles/${profile.id}/start`);
  check('profile reports running', status.state, 'running');
  check('a DevTools endpoint is reported', typeof status.debuggerUrl, 'string');

  const version = await (await fetch(`${status.debuggerUrl}/json/version`)).json();
  check('DevTools endpoint answers with the profile user agent', version['User-Agent'], profile.userAgent);

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

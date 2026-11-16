// Proteus browser test.
//
// Every check asks a question whose answer is known for an unmodified browser on a
// real device, so a wrong answer reveals tampering or an identity whose parts do not
// agree. Everything runs in this page: nothing is sent anywhere.
'use strict';

// What each check is called on the page and why it matters.
const CHECKS = [
  ['Canvas', 'canvasPutRoundTrip', 'Pixels a page wrote come back unchanged',
   'Noise added to every readback changes pixels the page itself put there. Sites test exactly that.'],
  ['Canvas', 'canvasKnownRects', 'Flat colours are exact',
   'A filled rectangle has one right answer on every device. Anything else is tampering.'],
  ['Canvas', 'canvasRepeatable', 'Reading twice gives the same pixels',
   'Random noise differs between reads; a real device never does.'],
  ['Canvas', 'canvasTwoCanvasesAgree', 'Two canvases with the same drawing agree', ''],
  ['Canvas', 'canvasSubrectAgrees', 'Part of a canvas matches the whole',
   'Reading a region must give the same pixels as cutting it out of a full read.'],
  ['Canvas', 'canvasPngMatchesPixels', 'The exported image matches the pixels',
   'The PNG from toDataURL must decode to what getImageData reports.'],
  ['Canvas', 'canvasCopyAgrees', 'A copy of a canvas reads the same', ''],
  ['Canvas', 'canvasShiftInvariant', 'A drawing moved by whole pixels is the same drawing',
   'Real rendering does not depend on where on the canvas it happens; position-based noise does.'],
  ['WebGL', 'webglClearExact', 'A cleared WebGL surface is exact', ''],
  ['WebGL', 'webglMatches2dCopy', 'WebGL pixels match a 2D copy of them',
   'Reading the WebGL surface directly and through a 2D canvas must agree.'],
  ['Audio', 'audioKnownBufferExact', 'A sound the page supplied comes back unchanged',
   'Playing a known buffer through an untouched graph has one right answer.'],
  ['Audio', 'audioRepeatable', 'Rendering twice gives the same samples', ''],
  ['Audio', 'audioChannelsAgree', 'One source gives two identical stereo channels', ''],
  ['Audio', 'audioCopyMatchesChannel', 'Two ways of reading samples agree', ''],
  ['Identity', 'platformMatchesUa', 'navigator.platform fits the user agent',
   'A Windows user agent with a Linux platform is a classic give-away.'],
  ['Identity', 'clientHintsPlatformMatchesUa', 'Client hints name the same system', ''],
  ['Identity', 'clientHintsVersionMatchesUa', 'Client hints name the same browser version', ''],
  ['Identity', 'clientHintsFullVersionMatches', 'Detailed client hints agree with the short ones', ''],
  ['Identity', 'workerMatchesPage', 'A worker sees the same identity as the page',
   'Overrides made by injected scripts usually miss workers.'],
  ['Identity', 'screenConsistent', 'The screen numbers describe one possible display',
   'Available size within the screen, window within the screen, and CSS media queries agreeing with them.'],
  ['Identity', 'timeZoneConsistent', 'Date and Intl agree on the time zone', ''],
  ['System fit', 'webglFitsSystem', 'The graphics stack fits the claimed system',
   'Direct3D belongs to Windows, Metal to Apple systems; a software renderer suggests a virtual machine.'],
  ['System fit', 'webgpuMatchesWebgl', 'WebGPU and WebGL name the same graphics vendor', ''],
  ['System fit', 'fontsFitSystem', 'The fonts fit the claimed system',
   'The claimed system\'s own fonts are present and another system\'s are not.'],
  ['System fit', 'voicesFitSystem', 'The speech voices fit the claimed system', ''],
  ['Integrity', 'nativeAccessors', 'Browser functions are still native',
   'Properties replaced from script stop looking like the browser\'s own functions.'],
  ['Integrity', 'notAutomated', 'No automation marker', 'navigator.webdriver is false.'],
  ['Integrity', 'geometryExact', 'Layout geometry is exact',
   'A box at known coordinates reports those coordinates; some tools add noise here.'],
];

const checks = {};
const hashes = {};
const set = (name, value) => { checks[name] = value === 'na' ? 'na' : (value ? 1 : 0); };
const attempt = async (name, fn) => { try { set(name, await fn()); } catch { checks[name] = 'na'; } };
const within = (promise, ms, fallback) =>
    Promise.race([promise, new Promise((resolve) => setTimeout(() => resolve(fallback), ms))]);

function fnv(bytes) {
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) { h ^= bytes[i]; h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, '0');
}
function prng(seed) {
  let s = seed >>> 0;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s >>> 24; };
}
function same(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
function canvas2d(w, h) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  return [c, c.getContext('2d', { willReadFrequently: true })];
}
function drawScene(g) {
  g.fillStyle = '#f60'; g.fillRect(10, 10, 100, 40);
  g.fillStyle = '#069'; g.font = '18px Arial';
  g.fillText('Cwm fjordbank glyphs vext quiz, 1234567890', 4, 60);
  g.strokeStyle = 'rgba(102,204,0,0.7)';
  g.beginPath(); g.arc(240, 30, 22, 0, Math.PI * 2); g.stroke();
}

function canvasKnown() {
  const [, g] = canvas2d(64, 64);
  const next = prng(12345), image = g.createImageData(64, 64);
  for (let i = 0; i < image.data.length; i += 4) {
    image.data[i] = next(); image.data[i + 1] = next(); image.data[i + 2] = next(); image.data[i + 3] = 255;
  }
  g.putImageData(image, 0, 0);
  set('canvasPutRoundTrip', same(image.data, g.getImageData(0, 0, 64, 64).data));

  const [, s] = canvas2d(64, 64);
  s.fillStyle = '#204060'; s.fillRect(0, 0, 64, 64);
  s.fillStyle = '#c08040';
  for (let x = 0; x < 64; x += 4) s.fillRect(x, 0, 2, 64);
  const got = s.getImageData(0, 0, 64, 64).data;
  let exact = true;
  for (let i = 0; i < got.length && exact; i += 4) {
    const on = (i / 4) % 64 % 4 < 2;
    exact = got[i] === (on ? 0xc0 : 0x20) && got[i + 1] === (on ? 0x80 : 0x40) &&
            got[i + 2] === (on ? 0x40 : 0x60) && got[i + 3] === 255;
  }
  set('canvasKnownRects', exact);
}

async function canvasBehaviour() {
  const [c1, g1] = canvas2d(300, 80); drawScene(g1);
  const [c2, g2] = canvas2d(300, 80); drawScene(g2);
  const a = g1.getImageData(0, 0, 300, 80).data;
  hashes.canvas = fnv(a);
  set('canvasRepeatable', same(a, g1.getImageData(0, 0, 300, 80).data));
  set('canvasTwoCanvasesAgree', same(a, g2.getImageData(0, 0, 300, 80).data) && c1.toDataURL() === c2.toDataURL());
  const part = g1.getImageData(40, 10, 100, 50).data;
  let subrect = true;
  for (let y = 0; y < 50 && subrect; y++) for (let x = 0; x < 400; x++) {
    if (part[y * 400 + x] !== a[(10 + y) * 1200 + 160 + x]) { subrect = false; break; }
  }
  set('canvasSubrectAgrees', subrect);

  await attempt('canvasPngMatchesPixels', async () => {
    const image = new Image();
    image.src = c1.toDataURL();
    await image.decode();
    const [, g3] = canvas2d(300, 80);
    g3.drawImage(image, 0, 0);
    return same(a, g3.getImageData(0, 0, 300, 80).data);
  });
  const [, g4] = canvas2d(300, 80);
  g4.drawImage(c1, 0, 0);
  set('canvasCopyAgrees', same(a, g4.getImageData(0, 0, 300, 80).data));

  const [, g5] = canvas2d(300, 80);
  g5.translate(7, 5); drawScene(g5);
  const moved = g5.getImageData(0, 0, 300, 80).data;
  let shifted = true;
  for (let y = 0; y < 75 && shifted; y++) for (let x = 0; x < 293 * 4; x++) {
    if (a[y * 1200 + x] !== moved[(y + 5) * 1200 + 28 + x]) { shifted = false; break; }
  }
  set('canvasShiftInvariant', shifted);
}

function webgl() {
  const c = document.createElement('canvas'); c.width = 64; c.height = 64;
  const gl = c.getContext('webgl', { preserveDrawingBuffer: true });
  if (!gl) { checks.webglClearExact = checks.webglMatches2dCopy = 'na'; return null; }
  gl.clearColor(0.2, 0.4, 0.6, 1); gl.clear(gl.COLOR_BUFFER_BIT);
  const flat = new Uint8Array(64 * 64 * 4);
  gl.readPixels(0, 0, 64, 64, gl.RGBA, gl.UNSIGNED_BYTE, flat);
  let exact = true;
  for (let i = 0; i < flat.length && exact; i += 4) {
    exact = flat[i] === 51 && flat[i + 1] === 102 && flat[i + 2] === 153 && flat[i + 3] === 255;
  }
  set('webglClearExact', exact);

  const vs = gl.createShader(gl.VERTEX_SHADER);
  gl.shaderSource(vs, 'attribute vec2 p; varying vec2 v; void main(){ v = p; gl_Position = vec4(p, 0., 1.); }');
  gl.compileShader(vs);
  const fs = gl.createShader(gl.FRAGMENT_SHADER);
  gl.shaderSource(fs, 'precision mediump float; varying vec2 v; void main(){ gl_FragColor = vec4(sin(v.x*9.)*.5+.5, cos(v.y*7.)*.5+.5, fract(v.x*v.y*5.), 1.); }');
  gl.compileShader(fs);
  const program = gl.createProgram();
  gl.attachShader(program, vs); gl.attachShader(program, fs); gl.linkProgram(program); gl.useProgram(program);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-0.9, -0.8, 0.8, -0.9, 0.1, 0.9]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  const direct = new Uint8Array(64 * 64 * 4);
  gl.readPixels(0, 0, 64, 64, gl.RGBA, gl.UNSIGNED_BYTE, direct);
  hashes.webgl = fnv(direct);
  const [, g] = canvas2d(64, 64);
  g.drawImage(c, 0, 0);
  const copy = g.getImageData(0, 0, 64, 64).data;
  let agree = true;
  for (let y = 0; y < 64 && agree; y++) for (let x = 0; x < 256; x++) {
    if (direct[(63 - y) * 256 + x] !== copy[y * 256 + x]) { agree = false; break; }
  }
  set('webglMatches2dCopy', agree);
  const info = gl.getExtension('WEBGL_debug_renderer_info');
  return {
    vendor: info ? gl.getParameter(info.UNMASKED_VENDOR_WEBGL) : '',
    renderer: info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : '',
    maxTexture: gl.getParameter(gl.MAX_TEXTURE_SIZE),
    extensions: (gl.getSupportedExtensions() || []).length,
  };
}

async function audio() {
  const Offline = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  if (!Offline) {
    for (const name of ['audioKnownBufferExact', 'audioRepeatable', 'audioChannelsAgree', 'audioCopyMatchesChannel']) checks[name] = 'na';
    return;
  }
  await attempt('audioKnownBufferExact', async () => {
    const n = 4096, ctx = new Offline(1, n, 44100), buffer = ctx.createBuffer(1, n, 44100);
    const input = buffer.getChannelData(0);
    for (let i = 0; i < n; i++) input[i] = Math.fround(Math.sin(i / 7) * 0.5);
    const expected = Float32Array.from(input), src = ctx.createBufferSource();
    src.buffer = buffer; src.connect(ctx.destination); src.start(0);
    return same(expected, (await ctx.startRendering()).getChannelData(0));
  });
  const render = async (channels = 1) => {
    const ctx = new Offline(channels, 5000, 44100), osc = ctx.createOscillator(), comp = ctx.createDynamicsCompressor();
    osc.type = 'triangle'; osc.frequency.value = 10000;
    osc.connect(comp); comp.connect(ctx.destination); osc.start(0);
    return ctx.startRendering();
  };
  try { hashes.audio = fnv(new Uint8Array((await render()).getChannelData(0).buffer)); } catch { /* no hash */ }
  await attempt('audioRepeatable', async () => same((await render()).getChannelData(0), (await render()).getChannelData(0)));
  await attempt('audioChannelsAgree', async () => {
    const buffer = await render(2);
    return same(buffer.getChannelData(0), buffer.getChannelData(1));
  });
  await attempt('audioCopyMatchesChannel', async () => {
    const buffer = await render(), copy = new Float32Array(5000);
    buffer.copyFromChannel(copy, 0);
    return same(copy, buffer.getChannelData(0));
  });
}

const osOf = (text) => /Windows/i.test(text) ? 'win' : /iPhone|iPad/i.test(text) ? 'ios' : /Mac/i.test(text) ? 'mac'
    : /Android/i.test(text) ? 'android' : /Linux|X11/i.test(text) ? 'linux' : 'other';
const OS_NAMES = { win: 'Windows', mac: 'macOS', linux: 'Linux', android: 'Android', ios: 'iOS', other: 'another system' };

function workerFacts() {
  const code = `postMessage({ ua: navigator.userAgent, platform: navigator.platform, cores: navigator.hardwareConcurrency,
    memory: navigator.deviceMemory, languages: navigator.languages.join(','),
    zone: Intl.DateTimeFormat().resolvedOptions().timeZone, offset: new Date(2026, 0, 15).getTimezoneOffset(),
    chPlatform: navigator.userAgentData ? navigator.userAgentData.platform : '' })`;
  const worker = new Worker(URL.createObjectURL(new Blob([code])));
  return within(new Promise((resolve) => { worker.onmessage = (event) => resolve(event.data); }), 4000, null);
}

async function identity(glInfo, facts) {
  const ua = navigator.userAgent, os = osOf(ua);
  const expectedPlatform = { win: /^Win32$/, mac: /^MacIntel$/, linux: /^Linux /, android: /^Linux /, ios: /^iP(hone|ad)$/ }[os];
  set('platformMatchesUa', expectedPlatform ? expectedPlatform.test(navigator.platform) : 'na');
  const uad = navigator.userAgentData;
  const major = (/Chrome\/(\d+)/.exec(ua) || [])[1];
  if (uad) {
    set('clientHintsPlatformMatchesUa', osOf(uad.platform) === os || (os === 'mac' && uad.platform === 'macOS'));
    set('clientHintsVersionMatchesUa', uad.brands.some((b) => /Chromium/.test(b.brand) && b.version === major));
    await attempt('clientHintsFullVersionMatches', async () => {
      const high = await uad.getHighEntropyValues(['uaFullVersion', 'fullVersionList', 'platformVersion', 'model']);
      facts.model = high.model || '';
      facts.systemVersion = `${uad.platform} ${high.platformVersion || ''}`.trim();
      return high.uaFullVersion.split('.')[0] === major &&
          high.fullVersionList.every((b) => /Not/.test(b.brand) || b.version.split('.')[0] === major);
    });
  } else {
    checks.clientHintsPlatformMatchesUa = checks.clientHintsVersionMatchesUa = checks.clientHintsFullVersionMatches = 'na';
  }
  await attempt('workerMatchesPage', async () => {
    const w = await workerFacts();
    if (!w) return 'na';
    return w.ua === ua && w.platform === navigator.platform && w.cores === navigator.hardwareConcurrency &&
        w.memory === navigator.deviceMemory && w.languages === navigator.languages.join(',') &&
        w.zone === Intl.DateTimeFormat().resolvedOptions().timeZone &&
        w.offset === new Date(2026, 0, 15).getTimezoneOffset() && w.chPlatform === (uad ? uad.platform : '');
  });

  set('screenConsistent', screen.availWidth <= screen.width && screen.availHeight <= screen.height &&
      outerWidth <= screen.width && outerHeight <= screen.height + 1 &&
      matchMedia(`(device-width: ${screen.width}px)`).matches && matchMedia(`(device-height: ${screen.height}px)`).matches);

  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const offsetFromIntl = (date) => {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: zone, hourCycle: 'h23',
        year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' })
        .formatToParts(date).map((p) => [p.type, p.value]));
    return Math.round((date - Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second)) / 60000);
  };
  const winter = new Date(Date.UTC(2026, 0, 15, 12)), summer = new Date(Date.UTC(2026, 6, 15, 12));
  set('timeZoneConsistent', offsetFromIntl(winter) === winter.getTimezoneOffset() && offsetFromIntl(summer) === summer.getTimezoneOffset());

  if (glInfo && glInfo.renderer) {
    const fits = { win: /Direct3D|D3D/i, mac: /Metal|OpenGL|Apple/i, linux: /OpenGL|Vulkan|Mesa/i,
                   android: /OpenGL ES|Vulkan|Adreno|Mali/i, ios: /Apple/i }[os];
    set('webglFitsSystem', fits ? fits.test(glInfo.renderer) && !/SwiftShader|llvmpipe/i.test(glInfo.renderer) : 'na');
  } else checks.webglFitsSystem = 'na';
  await attempt('webgpuMatchesWebgl', async () => {
    if (!navigator.gpu || !glInfo || !glInfo.renderer) return 'na';
    const adapter = await within(navigator.gpu.requestAdapter(), 3000, null);
    if (!adapter || !adapter.info || !adapter.info.vendor) return 'na';
    const family = (text) => (/nvidia/i.exec(text) || /intel/i.exec(text) || /amd|radeon|ati/i.exec(text) || /apple/i.exec(text) ||
        /qualcomm|adreno/i.exec(text) || /arm|mali/i.exec(text) || /google|swiftshader/i.exec(text) || ['?'])[0].toLowerCase()
        .replace(/radeon|ati/, 'amd').replace('adreno', 'qualcomm').replace('mali', 'arm').replace('swiftshader', 'google');
    return family(adapter.info.vendor) === family(glInfo.renderer);
  });

  const has = (font) => document.fonts.check(`16px "${font}"`) && (() => {
    const [, g] = canvas2d(10, 10);
    g.font = '72px monospace'; const base = g.measureText('mmmmmmmmlli').width;
    g.font = `72px "${font}", monospace`; return g.measureText('mmmmmmmmlli').width !== base;
  })();
  const own = { win: ['Segoe UI', 'Calibri'], mac: ['Helvetica Neue', 'Menlo'], linux: ['DejaVu Sans', 'Liberation Sans'] };
  if (own[os]) {
    const foreign = Object.entries(own).filter(([k]) => k !== os).flatMap(([, fonts]) => fonts);
    set('fontsFitSystem', own[os].some(has) && !foreign.some(has));
  } else checks.fontsFitSystem = 'na';
  await attempt('voicesFitSystem', async () => {
    if (!('speechSynthesis' in window)) return 'na';
    const list = await new Promise((resolve) => {
      const read = () => speechSynthesis.getVoices();
      if (read().length) return resolve(read());
      speechSynthesis.onvoiceschanged = () => resolve(read());
      setTimeout(() => resolve(read()), 2000);
    });
    facts.voices = list.length;
    if (!list.length) return 'na';
    const local = list.filter((v) => v.localService).map((v) => v.name).join('|');
    if (os === 'win') return /Microsoft/.test(local);
    if (os === 'mac') return !/Microsoft/.test(local);
    return 'na';
  });

  const native = (fn) => typeof fn === 'function' && /\{\s*\[native code\]\s*\}/.test(Function.prototype.toString.call(fn));
  const getter = (proto, name) => (Object.getOwnPropertyDescriptor(proto, name) || {}).get;
  set('nativeAccessors', [
    getter(Navigator.prototype, 'userAgent'), getter(Navigator.prototype, 'platform'),
    getter(Navigator.prototype, 'hardwareConcurrency'), getter(Navigator.prototype, 'languages'),
    getter(Screen.prototype, 'width'), HTMLCanvasElement.prototype.toDataURL,
    CanvasRenderingContext2D.prototype.getImageData, window.WebGLRenderingContext && WebGLRenderingContext.prototype.getParameter,
    AudioBuffer.prototype.getChannelData, Intl.DateTimeFormat.prototype.resolvedOptions,
    Date.prototype.getTimezoneOffset,
  ].every(native) && Object.getOwnPropertyNames(navigator).length === 0 && Object.getOwnPropertyNames(screen).length === 0);
  set('notAutomated', navigator.webdriver === false);

  const r = document.getElementById('probe').getBoundingClientRect();
  set('geometryExact', r.x === 10.25 && r.y === 20.5 && r.width === 100.5 && r.height === 40.25);
}

// --- The page ----------------------------------------------------------------------

const $ = (id) => document.getElementById(id);

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function renderChecks() {
  const list = $('checks');
  list.replaceChildren();
  let group = '';
  for (const [groupName, id, title, why] of CHECKS) {
    if (groupName !== group) { group = groupName; list.append(element('div', 'group', groupName)); }
    const state = checks[id];
    const row = element('div', 'check' + (state === 1 ? ' pass' : state === 0 ? ' fail' : ''));
    row.append(element('div', 'dot', state === 1 ? '✓' : state === 0 ? '!' : '–'));
    const body = element('div');
    body.append(element('h3', '', title));
    if (why) body.append(element('p', '', why));
    row.append(body, element('span', 'tag', state === 1 ? 'Consistent' : state === 0 ? 'Detectable' : state === undefined ? '…' : 'Not applicable'));
    list.append(row);
  }
}

function renderFacts(facts, glInfo) {
  const os = osOf(navigator.userAgent);
  const rows = [
    ['Browser', navigator.userAgent],
    ['Claims to be', OS_NAMES[os] + (facts.systemVersion ? ` (${facts.systemVersion})` : '') + (facts.model ? `, ${facts.model}` : '')],
    ['Platform / vendor', `${navigator.platform} / ${navigator.vendor || '—'}`],
    ['Screen', `${screen.width} × ${screen.height} at ${devicePixelRatio}×, page ${innerWidth} × ${innerHeight}`],
    ['Processors / memory', `${navigator.hardwareConcurrency ?? '—'} / ${navigator.deviceMemory ? navigator.deviceMemory + ' GB' : '—'}`],
    ['Graphics', glInfo && glInfo.renderer ? glInfo.renderer : '—'],
    ['Graphics limits', glInfo ? `largest texture ${glInfo.maxTexture}, ${glInfo.extensions} extensions` : '—'],
    ['Languages', navigator.languages.join(', ')],
    ['Time zone', Intl.DateTimeFormat().resolvedOptions().timeZone],
    ['Touch points', String(navigator.maxTouchPoints)],
    ['Voices', facts.voices === undefined ? '—' : String(facts.voices)],
  ];
  $('facts').replaceChildren(...rows.map(([name, value]) => {
    const tr = element('tr');
    tr.append(element('td', '', name), element('td', '', value));
    return tr;
  }));
}

function renderScore() {
  const applicable = CHECKS.map(([, id]) => checks[id]).filter((state) => state === 0 || state === 1);
  const passed = applicable.filter((state) => state === 1).length;
  const failed = applicable.length - passed;
  const ring = $('ring');
  ring.style.setProperty('--value', applicable.length ? String(100 * passed / applicable.length) : '0');
  ring.style.setProperty('--color', failed === 0 ? 'var(--ok)' : 'var(--bad)');
  $('score').textContent = `${passed}/${applicable.length}`;
  $('verdict').textContent = failed === 0 ? 'Nothing stands out' : `${failed} thing${failed === 1 ? '' : 's'} a site could notice`;
  $('score-note').textContent = failed === 0
      ? 'Every check that applies here gave the answer a real device gives.'
      : 'The checks marked “Detectable” below gave an answer a real device does not.';
  for (const [name, id] of [['canvas', 'hash-canvas'], ['webgl', 'hash-webgl'], ['audio', 'hash-audio']]) {
    $(id).textContent = hashes[name] || '—';
  }
  return { passed, total: applicable.length };
}

function report(facts, glInfo, score) {
  const lines = [`Proteus browser test — ${score.passed}/${score.total}`, navigator.userAgent,
    `canvas ${hashes.canvas || '-'}  webgl ${hashes.webgl || '-'}  audio ${hashes.audio || '-'}`, ''];
  for (const [group, id, title] of CHECKS) {
    const state = checks[id];
    lines.push(`${state === 1 ? 'ok  ' : state === 0 ? 'FAIL' : 'n/a '} ${group}: ${title}`);
  }
  return lines.join('\n');
}

async function run() {
  $('run').disabled = true;
  $('run-note').textContent = 'Testing…';
  for (const key of Object.keys(checks)) delete checks[key];
  for (const key of Object.keys(hashes)) delete hashes[key];
  renderChecks();
  const facts = {};
  let glInfo = null;
  try {
    canvasKnown();
    await canvasBehaviour();
    glInfo = webgl();
    await audio();
    await identity(glInfo, facts);
  } catch (error) {
    $('run-note').textContent = 'The test stopped early: ' + error.message;
  }
  for (const [, id] of CHECKS) if (checks[id] === undefined) checks[id] = 'na';
  renderChecks();
  renderFacts(facts, glInfo);
  const score = renderScore();
  $('copy').onclick = async () => {
    try { await navigator.clipboard.writeText(report(facts, glInfo, score)); $('run-note').textContent = 'Results copied.'; }
    catch { $('run-note').textContent = 'Could not copy from this page.'; }
  };
  $('copy').disabled = false;
  $('run').disabled = false;
  if ($('run-note').textContent === 'Testing…') $('run-note').textContent = 'Done. Nothing was sent anywhere.';
}

$('run').addEventListener('click', run);
renderChecks();
run();

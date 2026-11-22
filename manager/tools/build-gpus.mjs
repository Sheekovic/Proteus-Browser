// Builds manager/src/gpus.json: graphics cards as Chrome reported them on real
// computers, each with what it can do (WebGL limits, extensions, shader precision),
// its WebGPU names, and the processors it was seen with.
//
// The readings are Scrapfly's, published with daijro's fingerprint-generator ("fpgen",
// https://github.com/scrapfly/fingerprint-generator, Apache License 2.0) as a Bayesian
// network: for every card, the capabilities that were seen with it and how often. This
// tool takes, per card, the capabilities most often seen with it. Nothing is invented
// here: a card whose reading lacks something is left out, not filled in.
//
// usage: node build-gpus.mjs <directory>
//   The directory holds the unpacked model release (fingerprint-network.json.zst,
//   values.json.zst, values.dat.zst), from
//   https://github.com/scrapfly/fingerprint-generator/releases (this file was written
//   against model-2/2026).

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

const dir = process.argv[2];
if (!dir) { console.error('usage: node build-gpus.mjs <directory of the model release>'); process.exit(2); }
const MODEL = process.argv[3] ?? 'model-2/2026';

const unpack = (name) => zlib.zstdDecompressSync(readFileSync(join(dir, name)), { maxOutputLength: 1 << 30 });
const nodes = new Map(JSON.parse(unpack('fingerprint-network.json.zst').toString('utf8')).nodes.map((n) => [n.name, n]));
// values.json is one object, {"<offset in hex>": <length>, ...}, and the order of its
// entries is what counts. JSON.parse would move the offsets that read as whole numbers
// to the front, so the entries are read from the text as they stand.
const pairs = [...unpack('values.json.zst').toString('utf8').matchAll(/"([0-9a-f]+)"\s*:\s*(\d+)/g)]
  .map((m) => [m[1], Number(m[2])]);
const dat = unpack('values.dat.zst');

// The model names a value by a number written in base 85 (the alphabet of RFC 1924,
// as Python's base64.b85decode reads it): the value's place in values.json, which
// says where in values.dat its JSON is.
const B85 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz!#$%&()*+-;<=>?@^_`{|}~';
function tokenIndex(token) {
  const bytes = [];
  for (let i = 0; i < token.length; i += 5) {
    const chunk = token.slice(i, i + 5);
    const padding = 5 - chunk.length;
    let acc = 0;
    for (const c of chunk.padEnd(5, '~')) acc = acc * 85 + B85.indexOf(c);
    const four = [Math.floor(acc / 2 ** 24) % 256, (acc >>> 16) & 255, (acc >>> 8) & 255, acc & 255];
    bytes.push(...four.slice(0, 4 - padding));
  }
  return bytes.reduce((n, b) => n * 256 + b, 0);
}
const cache = new Map();
function value(token) {
  if (!cache.has(token)) {
    const [offset, length] = pairs[tokenIndex(token)];
    const start = parseInt(offset, 16);
    cache.set(token, JSON.parse(dat.subarray(start, start + length).toString('utf8')));
  }
  return cache.get(token);
}
const tokenOf = (nodeName, wanted) => nodes.get(nodeName).possibleValues.find((t) => value(t) === wanted);

/** The distribution of `nodeName` given its parents' tokens, as [token, probability] most likely first. */
function given(nodeName, ...parents) {
  let tree = nodes.get(nodeName).conditionalProbabilities;
  for (const parent of parents) {
    tree = tree?.[parent];
  }
  return tree ? Object.entries(tree).sort((a, b) => b[1] - a[1]) : [];
}

// --- Which readings are a person's computer -------------------------------------------
const PLATFORMS = {
  windows: 'Windows NT 10.0; Win64; x64',
  linux: 'X11; Linux x86_64',
  macos: 'Macintosh; Intel Mac OS X 10_15_7',
};
// Software renderers, virtual machines and remote desktops: real readings, but of
// servers and test machines, which is what a profile must not look like.
const NOT_A_PERSONS = /swiftshader|llvmpipe|softpipe|vmware|svga|virtualbox|parallels|basic render|microsoft remote|citrix|virgl|qxl|or similar|mesa offscreen|google inc\. \(google\)/i;
const BACKEND = {
  // What Chrome uses on each system unless someone changed it.
  windows: /^ANGLE \((Intel|NVIDIA|AMD), .+ Direct3D11 vs_5_0 ps_5_0, D3D11\)$/,
  linux: /^ANGLE \(.+, OpenGL( ES)? \d[^)]*\)$/,
  // The identity generator makes Macs with Apple's own chips.
  macos: /^ANGLE \(Apple, ANGLE Metal Renderer: Apple M\d[^,]*, Unspecified Version\)$/,
};

// --- From a reading to the shape the kernel takes (webglCaps.ts) ----------------------
// The limits the collector page reads (manager/ui/collect.html), by GL name.
const LIMITS = new Set([
  'MAX_TEXTURE_SIZE', 'MAX_VIEWPORT_DIMS', 'MAX_CUBE_MAP_TEXTURE_SIZE', 'MAX_RENDERBUFFER_SIZE',
  'MAX_VERTEX_ATTRIBS', 'MAX_VERTEX_UNIFORM_VECTORS', 'MAX_FRAGMENT_UNIFORM_VECTORS', 'MAX_VARYING_VECTORS',
  'MAX_COMBINED_TEXTURE_IMAGE_UNITS', 'MAX_VERTEX_TEXTURE_IMAGE_UNITS', 'MAX_TEXTURE_IMAGE_UNITS',
  'ALIASED_LINE_WIDTH_RANGE', 'ALIASED_POINT_SIZE_RANGE',
  'MAX_3D_TEXTURE_SIZE', 'MAX_ARRAY_TEXTURE_LAYERS', 'MAX_SAMPLES', 'MAX_DRAW_BUFFERS', 'MAX_COLOR_ATTACHMENTS',
  'MAX_UNIFORM_BUFFER_BINDINGS', 'MAX_UNIFORM_BLOCK_SIZE', 'MAX_COMBINED_UNIFORM_BLOCKS',
  'MAX_VERTEX_UNIFORM_BLOCKS', 'MAX_FRAGMENT_UNIFORM_BLOCKS', 'MAX_VERTEX_UNIFORM_COMPONENTS',
  'MAX_FRAGMENT_UNIFORM_COMPONENTS', 'MAX_VARYING_COMPONENTS', 'MAX_VERTEX_OUTPUT_COMPONENTS',
  'MAX_FRAGMENT_INPUT_COMPONENTS', 'MAX_ELEMENT_INDEX', 'MAX_ELEMENTS_INDICES', 'MAX_ELEMENTS_VERTICES',
  'MAX_TEXTURE_LOD_BIAS', 'MAX_TRANSFORM_FEEDBACK_INTERLEAVED_COMPONENTS',
  'MAX_TRANSFORM_FEEDBACK_SEPARATE_ATTRIBS', 'MAX_TRANSFORM_FEEDBACK_SEPARATE_COMPONENTS',
  'MAX_COMBINED_VERTEX_UNIFORM_COMPONENTS', 'MAX_COMBINED_FRAGMENT_UNIFORM_COMPONENTS',
  'MAX_PROGRAM_TEXEL_OFFSET', 'MIN_PROGRAM_TEXEL_OFFSET', 'UNIFORM_BUFFER_OFFSET_ALIGNMENT',
]);
const MAX_TEXTURE_MAX_ANISOTROPY_EXT = 0x84ff;
const VERTEX_SHADER = 35633, FRAGMENT_SHADER = 35632;
const PRECISIONS = [36336, 36337, 36338, 36339, 36340, 36341];   // low, medium, high float; low, medium, high int

const isNumber = (n) => typeof n === 'number' && Number.isFinite(n);

/** One context's reading as { p, e, s }, or null when it lacks any of the three. */
function contextCaps(reading) {
  if (!reading || typeof reading.params !== 'object' || !Array.isArray(reading.supportedExtensions)) return null;
  const p = {};
  for (const [pname, entry] of Object.entries(reading.params)) {
    if (!LIMITS.has(entry.name)) continue;
    if (isNumber(entry.value)) p[pname] = entry.value;
    else if (Array.isArray(entry.value) && entry.value.length >= 1 && entry.value.length <= 4 && entry.value.every(isNumber)) p[pname] = entry.value;
    else return null;
  }
  if (Object.keys(p).length < 11) return null;
  if (reading.supportedExtensions.includes('EXT_texture_filter_anisotropic')) {
    if (!isNumber(reading.maxAnisotropy)) return null;
    p[MAX_TEXTURE_MAX_ANISOTROPY_EXT] = reading.maxAnisotropy;
  }
  const s = [];
  for (const shader of [VERTEX_SHADER, FRAGMENT_SHADER]) {
    for (const precision of PRECISIONS) {
      const format = (reading.shaderPrecisionFormats ?? [])
        .find((f) => f.shaderType === shader && f.precisionType === precision)?.shaderPrecisionFormat;
      if (!format) return null;
      s.push(format.rangeMin, format.rangeMax, format.precision);
    }
  }
  return { p, e: [...reading.supportedExtensions].sort(), s };
}

const chrome = tokenOf('browser', 'Chrome');
const out = {
  source: 'Scrapfly fingerprint-generator (https://github.com/scrapfly/fingerprint-generator), Apache License 2.0',
  model: MODEL,
  note: 'Made by manager/tools/build-gpus.mjs. Graphics cards as Chrome reported them on real computers, ' +
        'each with the capabilities most often read with it. Not edited by hand.',
  caps: [],
  gpus: {},
};
const capsIndex = new Map();
const dropped = {};
const drop = (os, why) => { dropped[`${os}: ${why}`] = (dropped[`${os}: ${why}`] ?? 0) + 1; };

for (const [os, platformName] of Object.entries(PLATFORMS)) {
  const platform = tokenOf('platformInfo', platformName);
  const list = [];
  for (const [gpuToken, weight] of given('gpu', chrome, platform)) {
    const gpu = value(gpuToken);
    if (!gpu || typeof gpu.renderer !== 'string' || typeof gpu.vendor !== 'string') { drop(os, 'no card'); continue; }
    if (NOT_A_PERSONS.test(`${gpu.vendor} ${gpu.renderer}`)) { drop(os, 'software or virtual'); continue; }
    if (!BACKEND[os].test(gpu.renderer)) { drop(os, 'not the usual backend'); continue; }

    // The capabilities most often read with this card, WebGL 1 then the WebGL 2 that
    // went with it, then the WebGPU adapter that went with those.
    let found = null;
    for (const [webglToken] of given('webgl', chrome, platform, gpuToken)) {
      const one = contextCaps(value(webglToken));
      if (!one) continue;
      for (const [webgl2Token] of given('webgl2', chrome, platform, gpuToken, webglToken)) {
        const two = contextCaps(value(webgl2Token));
        if (!two) continue;
        for (const [infoToken] of given('gpuInfo', chrome, platform, gpuToken, webglToken, webgl2Token)) {
          const info = value(infoToken)?.adapter?.default?.info;
          if (info && typeof info.vendor === 'string' && info.vendor && typeof info.architecture === 'string' && info.architecture) {
            found = { one, two, webgpu: { vendor: info.vendor, architecture: info.architecture } };
            break;
          }
        }
        if (found) break;
      }
      if (found) break;
    }
    if (!found) { drop(os, 'incomplete reading'); continue; }

    // Processors seen with the card: [cores, how often].
    const cores = new Map();
    for (const [memoryToken, pMemory] of given('navigator.deviceMemory', chrome, platform, gpuToken)) {
      for (const [coresToken, pCores] of given('navigator.hardwareConcurrency', chrome, platform, gpuToken, memoryToken)) {
        const n = value(coresToken);
        if (Number.isInteger(n) && n >= 2 && n <= 64) cores.set(n, (cores.get(n) ?? 0) + pMemory * pCores);
      }
    }
    if (cores.size === 0) { drop(os, 'no processor'); continue; }

    const key = JSON.stringify([found.one, found.two]);
    if (!capsIndex.has(key)) { capsIndex.set(key, out.caps.length); out.caps.push({ 1: found.one, 2: found.two }); }
    list.push({
      vendor: gpu.vendor,
      renderer: gpu.renderer,
      webgpu: found.webgpu,
      caps: capsIndex.get(key),
      weight: Math.round(weight * 1e5) / 1e5,
      cores: [...cores].sort((a, b) => b[1] - a[1]).map(([n, p]) => [n, Math.round(p * 1e3) / 1e3]).filter(([, p]) => p > 0),
    });
  }
  out.gpus[os] = list;
}

const target = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'gpus.json');
// One card or table per line: readable in a diff, and a third of the size of indented JSON.
const lines = (items) => items.map((item) => '    ' + JSON.stringify(item)).join(',\n');
writeFileSync(target, `{
  "source": ${JSON.stringify(out.source)},
  "model": ${JSON.stringify(out.model)},
  "note": ${JSON.stringify(out.note)},
  "caps": [
${lines(out.caps)}
  ],
  "gpus": {
${Object.entries(out.gpus).map(([os, list]) => `  ${JSON.stringify(os)}: [\n${lines(list)}\n  ]`).join(',\n')}
  }
}
`);
for (const [os, list] of Object.entries(out.gpus)) console.log(`${os}: ${list.length} cards`);
console.log(`capability tables: ${out.caps.length}`);
console.log('left out:', dropped);
console.log('written:', target);

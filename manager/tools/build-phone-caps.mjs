// Makes manager/src/phone-caps.json from readings of real phones' hardware: what the
// collector page (manager/ui/collect.html) read on each, as tools/read-surface.mjs
// saves it when the page is opened on a phone.
//
// A generated phone identity names a graphics card. Without a reading of that card it
// reports the limits of the card of whatever machine it runs on. With one, an iPhone
// profile has what Safari on an iPhone says its card can do (every iPhone says "Apple
// GPU", so one reading serves all of them), and each Android phone that was read
// becomes a phone a profile can be: its model, screen, processor count, memory and
// card, with the card's own limits.
//
// usage: node build-phone-caps.mjs <fingerprint.json> [<fingerprint.json> ...]

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error('usage: node build-phone-caps.mjs <fingerprint.json> [<fingerprint.json> ...]');
  process.exit(2);
}
const out = {
  note: 'Made by manager/tools/build-phone-caps.mjs from readings of real phones. Not edited by hand.',
  ios: null,
  android: [],
};
for (const file of files) {
  const reading = JSON.parse(readFileSync(file, 'utf8'));
  if (!reading.secureContext) throw new Error(`${file} was not read on a secure page: the model and version details are missing`);
  if (!reading.webglCaps || !reading.webglCaps['1']) throw new Error(`${file} has no graphics capabilities`);
  const card = { vendor: reading.webgl.vendor, renderer: reading.webgl.renderer };
  if (/iPhone/.test(reading.userAgent)) {
    out.ios = {
      readFrom: reading.userAgent, readAt: reading.collectedAt, webgl: card, webglCaps: reading.webglCaps,
      webgpu: reading.webgpu ?? { vendor: '', architecture: '' },
    };
  } else if (/Android/.test(reading.userAgent)) {
    const model = reading.uaData?.model;
    if (!model) throw new Error(`${file}: the phone did not tell its model`);
    out.android = out.android.filter((phone) => phone.model !== model);
    out.android.push({
      model, readFrom: reading.userAgent, readAt: reading.collectedAt,
      width: reading.screen.width, height: reading.screen.height, pixelRatio: reading.devicePixelRatio,
      cores: reading.hardwareConcurrency, memory: reading.deviceMemory,
      webgl: card, webglCaps: reading.webglCaps, webgpu: reading.webgpu ?? { vendor: '', architecture: '' },
    });
  } else {
    throw new Error(`${file} is not a phone's reading`);
  }
}
out.android.sort((a, b) => a.model.localeCompare(b.model));
const target = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'phone-caps.json');
writeFileSync(target, JSON.stringify(out, null, 1) + '\n');
console.log(`iPhone: ${out.ios ? `${Object.keys(out.ios.webglCaps['1'].p).length} limits, ${out.ios.webglCaps['1'].e.length} extensions` : 'not read'}`);
for (const phone of out.android) console.log(`Android ${phone.model}: ${phone.webgl.renderer}, ${phone.width}x${phone.height} @${phone.pixelRatio}`);
console.log('written:', target);

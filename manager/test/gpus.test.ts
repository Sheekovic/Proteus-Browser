// Graphics cards read from real computers (src/gpus.json): a new Windows or Mac
// identity takes one, with that card's own capabilities.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { generateIdentity, readCapabilities, readCardCount } from '../src/fingerprint.ts';
import { identityFromPreset, listPresets } from '../src/presets.ts';
import { cleanWebGLCaps } from '../src/webglCaps.ts';

const KERNEL = '157.0.8103.79';
const file = JSON.parse(readFileSync(new URL('../src/gpus.json', import.meta.url), 'utf8'));

test('the file of readings holds cards a person\'s computer has, each with all it was read to do', () => {
  assert.match(file.source, /Apache License 2\.0/, 'where the readings come from, and under which licence');
  assert.ok(file.gpus.windows.length >= 150, `${file.gpus.windows.length} Windows cards`);
  assert.ok(file.gpus.macos.length >= 10, `${file.gpus.macos.length} Mac chips`);
  for (const [os, cards] of Object.entries(file.gpus) as [string, any[]][]) {
    assert.equal(new Set(cards.map((card) => card.renderer)).size, cards.length, `${os}: a card is listed once`);
    for (const card of cards) {
      assert.doesNotMatch(card.renderer, /swiftshader|llvmpipe|vmware|virtualbox|basic render|or similar/i);
      assert.ok(card.webgpu.vendor && card.webgpu.architecture, card.renderer);
      assert.ok(card.weight > 0 && card.cores.length > 0, card.renderer);
      const caps = file.caps[card.caps];
      // The kernel's own check of capabilities accepts every table as it is.
      assert.deepEqual(cleanWebGLCaps(caps), caps, card.renderer);
      for (const version of ['1', '2']) {
        assert.ok(Object.keys(caps[version].p).length >= 11, `${card.renderer}: limits`);
        assert.ok(caps[version].e.includes('WEBGL_debug_renderer_info'), `${card.renderer}: extensions`);
        assert.equal(caps[version].s.length, 36, `${card.renderer}: shader precision`);
      }
    }
  }
  for (const card of file.gpus.windows) assert.match(card.renderer, /^ANGLE \((Intel|NVIDIA|AMD), .+ Direct3D11 vs_5_0 ps_5_0, D3D11\)$/);
  for (const card of file.gpus.macos) assert.match(card.renderer, /^ANGLE \(Apple, ANGLE Metal Renderer: Apple M\d/);
});

test('a new Windows or Mac identity has a card that was read, with its capabilities and a processor seen with it', () => {
  for (const os of ['windows', 'macos'] as const) {
    const cards = new Map<string, any>(file.gpus[os].map((card: any) => [card.renderer, card]));
    const seen = new Set<string>();
    for (let i = 0; i < 300; i++) {
      const identity = generateIdentity(os, KERNEL);
      const card = cards.get(identity.webgl.renderer);
      assert.ok(card, `${os}: ${identity.webgl.renderer} is in the readings`);
      seen.add(card.renderer);
      assert.equal(identity.webgl.vendor, card.vendor);
      assert.deepEqual(identity.webgpu, card.webgpu, 'the WebGPU names read with the card');
      assert.deepEqual(identity.webglCaps, file.caps[card.caps], 'the capabilities read with the card');
      assert.ok(card.cores.some(([cores]: [number, number]) => cores === identity.hardwareConcurrency),
          `${card.renderer}: ${identity.hardwareConcurrency} cores were seen with it`);
      if (os === 'windows') assert.equal(identity.hardwareConcurrency % 2, 0, 'an even number of cores');
    }
    assert.ok(seen.size >= (os === 'windows' ? 60 : 8), `${os}: ${seen.size} different cards in 300 identities`);
    assert.ok(readCardCount(os) >= seen.size);
  }
});

test('a Linux identity, for which there is no reading, is as before', () => {
  assert.equal(readCardCount('linux'), 0);
  const identity = generateIdentity('linux', KERNEL);
  assert.equal(identity.webglCaps, null);
  assert.notEqual(identity.webgpu.architecture, '');
});

test('a profile gets a copy of the capabilities, and a ready-made setup its card\'s when it was read', () => {
  const card = file.gpus.windows[0];
  const caps = readCapabilities('windows', card.renderer)!;
  caps['1']!.e!.length = 0;
  assert.ok(readCapabilities('windows', card.renderer)!['1']!.e!.length > 0, 'changing one profile\'s does not change the file\'s');
  assert.equal(readCapabilities('windows', 'ANGLE (Nobody, No Such Card Direct3D11 vs_5_0 ps_5_0, D3D11)'), null);

  for (const preset of listPresets()) {
    if (preset.os !== 'windows' && preset.os !== 'macos') continue;
    const identity = identityFromPreset(preset.id, KERNEL);
    const read = file.gpus[preset.os].find((reading: any) => reading.renderer === identity.webgl.renderer);
    assert.ok(read, `${preset.id}: its card, ${identity.webgl.renderer}, was read`);
    assert.deepEqual(identity.webglCaps, file.caps[read.caps], preset.id);
    assert.deepEqual(identity.webgpu, read.webgpu, `${preset.id}: the WebGPU names agree with the reading`);
  }
});

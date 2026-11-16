import assert from 'node:assert/strict';
import { join } from 'node:path';
import { beforeEach, test } from 'node:test';

import { buildKernelArgs } from '../src/kernelConfig.ts';
import { allowSandboxToReadKernel, grantArguments, resetSandboxAccessCache } from '../src/winSandbox.ts';
import { generateIdentity } from '../src/fingerprint.ts';
import type { Profile } from '../src/profile.ts';

beforeEach(resetSandboxAccessCache);

const kernel = join('C:', 'Proteus', 'kernel', 'chrome.exe');

test('app containers get read and execute on the kernel folder, once', async () => {
  const calls: string[][] = [];
  const run = async (program: string, args: string[]) => { calls.push([program, ...args]); return 0; };
  assert.equal(await allowSandboxToReadKernel(kernel, 'win32', run), true);
  assert.equal(await allowSandboxToReadKernel(kernel, 'win32', run), true);
  assert.equal(calls.length, 1, 'not repeated for the same folder');
  const [program, folder, ...rest] = calls[0];
  assert.equal(program, 'icacls');
  assert.equal(folder, join('C:', 'Proteus', 'kernel'), 'the folder, not the file');
  assert.deepEqual(rest, ['/grant', '*S-1-15-2-1:(OI)(CI)(RX)', '*S-1-15-2-2:(OI)(CI)(RX)', '/T', '/Q']);
  assert.deepEqual(grantArguments('X'), ['X', ...rest]);
});

test('a refusal or a missing tool is reported, not thrown', async () => {
  assert.equal(await allowSandboxToReadKernel(kernel, 'win32', async () => 5), false);
  resetSandboxAccessCache();
  assert.equal(await allowSandboxToReadKernel(kernel, 'win32', async () => { throw new Error('no icacls'); }), false);
});

test('nothing is run on other systems', async () => {
  let ran = false;
  const run = async () => { ran = true; return 0; };
  assert.equal(await allowSandboxToReadKernel('/opt/proteus/kernel/chrome', 'linux', run), true);
  assert.equal(await allowSandboxToReadKernel('/Applications/Proteus/chrome', 'darwin', run), true);
  assert.equal(ran, false);
});

test('the network sandbox stays on unless the kernel folder could not be opened up', () => {
  const profile = {
    ...generateIdentity('windows', '158.0.8127.37'), id: 'x', name: 'n', notes: '', createdAt: '', updatedAt: '',
    languages: [], timezone: '', webrtc: 'proxyOnly', webrtcPublicIp: '', geolocation: null, proxy: null,
    matchProxy: false, startUrl: '',
  } as Profile;
  const paths = { userDataDir: 'u', configFile: 'c' };
  const features = (args: string[]) => args.filter((a) => a.startsWith('--disable-features='));

  const normal = features(buildKernelArgs(profile, paths, []));
  assert.equal(normal.length, 1, 'one list: a second switch would replace the first');
  assert.ok(!normal[0].includes('NetworkServiceSandbox'));
  assert.ok(normal[0].includes('OptimizationHints'));
  assert.deepEqual(features(buildKernelArgs(profile, { ...paths, networkSandbox: true }, [])), normal);

  const fallback = features(buildKernelArgs(profile, { ...paths, networkSandbox: false }, []));
  assert.equal(fallback.length, 1);
  assert.ok(fallback[0].endsWith(',NetworkServiceSandbox'));
  assert.ok(fallback[0].startsWith(normal[0]));
});

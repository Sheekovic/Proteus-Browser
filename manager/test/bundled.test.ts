import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';

import { appWindowArguments, findKernel, openCommand } from '../src/bundled.ts';
import { buildKernelArgs, DO_NOT_DE_ELEVATE } from '../src/kernelConfig.ts';
import { Store } from '../src/store.ts';

const root = mkdtempSync(join(tmpdir(), 'proteus-bundled-'));
after(() => rmSync(root, { recursive: true, force: true }));

test('the kernel next to the manager is found, per platform', () => {
  const managerDir = join(root, 'Proteus', 'manager');
  mkdirSync(join(root, 'Proteus', 'kernel'), { recursive: true });
  mkdirSync(managerDir, { recursive: true });
  assert.equal(findKernel(managerDir, {}, 'win32'), undefined, 'nothing there yet');

  writeFileSync(join(root, 'Proteus', 'kernel', 'chrome.exe'), '');
  assert.equal(findKernel(managerDir, {}, 'win32'), join(managerDir, '..', 'kernel', 'chrome.exe'));
  assert.equal(findKernel(managerDir, {}, 'linux'), undefined, 'a Windows kernel is not a Linux one');

  writeFileSync(join(root, 'Proteus', 'kernel', 'chrome'), '');
  assert.equal(findKernel(managerDir, {}, 'linux'), join(managerDir, '..', 'kernel', 'chrome'));
});

test('PROTEUS_KERNEL wins when it names a file that exists', () => {
  const managerDir = join(root, 'Proteus', 'manager');
  const other = join(root, 'other-kernel.exe');
  writeFileSync(other, '');
  assert.equal(findKernel(managerDir, { PROTEUS_KERNEL: other }, 'win32'), other);
  // A name that leads nowhere falls back to the kernel next to the manager.
  assert.equal(findKernel(managerDir, { PROTEUS_KERNEL: join(root, 'missing.exe') }, 'win32'),
               join(managerDir, '..', 'kernel', 'chrome.exe'));
  assert.equal(findKernel(managerDir, { PROTEUS_KERNEL: '' }, 'win32'), join(managerDir, '..', 'kernel', 'chrome.exe'));
});

test('the UI is opened with the system\'s own command', () => {
  const url = 'http://127.0.0.1:5310';
  assert.deepEqual(openCommand(url, 'win32'), ['cmd', '/c', 'start', '', url]);
  assert.deepEqual(openCommand(url, 'darwin'), ['open', url]);
  assert.deepEqual(openCommand(url, 'linux'), ['xdg-open', url]);
});

test('a kernel started as administrator stays the process that was started', async () => {
  // Without this Chrome starts itself again without the rights and ends: the manager
  // took that for its window being closed and stopped.
  assert.ok(appWindowArguments('http://127.0.0.1:5310', join(root, 'data')).includes(DO_NOT_DE_ELEVATE));
  const store = new Store(join(root, 'store'));
  const profile = await store.createProfile({ name: 'one', os: 'windows' });
  assert.ok(buildKernelArgs(profile, { userDataDir: 'u', configFile: 'c' }, []).includes(DO_NOT_DE_ELEVATE));
});

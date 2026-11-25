// Starting with the machine: the setting, what the system is told, and that nothing
// is told unless the user turned it on.

import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';

import { autostartPlan, RUN_KEY, RUN_VALUE, setAutostart } from '../src/autostart.ts';
import { ValidationError } from '../src/profile.ts';
import { Store } from '../src/store.ts';

let dir: string;
before(async () => { dir = await mkdtemp(join(tmpdir(), 'proteus-autostart-')); });
after(async () => { await rm(dir, { recursive: true, force: true }); });

test('it is off until the user turns it on, and the system is told only of a change', async () => {
  const store = new Store(join(dir, 'data'));
  assert.equal((await store.getSettings()).startWithMachine, false);
  const told: boolean[] = [];
  store.applyStartWithMachine = async (on) => { told.push(on); };

  await store.updateSettings({ autoUpdateCheck: false });
  await store.updateSettings({ startWithMachine: false });
  assert.deepEqual(told, [], 'nothing changed, nothing told');

  assert.equal((await store.updateSettings({ startWithMachine: true })).startWithMachine, true);
  await store.updateSettings({ startWithMachine: true });
  assert.equal((await store.updateSettings({ startWithMachine: false })).startWithMachine, false);
  assert.deepEqual(told, [true, false]);

  await assert.rejects(store.updateSettings({ startWithMachine: 'yes' as never }), ValidationError);
});

test('a start the system refuses is not saved as on', async () => {
  const store = new Store(join(dir, 'refused'));
  store.applyStartWithMachine = async () => { throw new ValidationError('not here'); };
  await assert.rejects(store.updateSettings({ startWithMachine: true }), /not here/);
  assert.equal((await store.getSettings()).startWithMachine, false);
});

test('on Windows it is a value in the user\'s own Run key that starts the folder\'s script', async () => {
  const place = { platform: 'win32' as const, managerDir: 'C:\\Apps\\Proteus\\manager', nodePath: 'C:\\node\\node.exe' };
  const release = autostartPlan({ ...place, exists: () => true });
  assert.deepEqual(release, { kind: 'registry', command: 'cmd.exe /c start "Proteus" /min "C:\\Apps\\Proteus\\Start Proteus.cmd"' });
  const source = autostartPlan({ ...place, exists: () => false });
  assert.ok(source?.kind === 'registry' && source.command.endsWith('/min "C:\\node\\node.exe" "C:\\Apps\\Proteus\\manager\\src\\main.ts" --open'), JSON.stringify(source));

  const calls: string[][] = [];
  let there = false;
  const run = async (program: string, args: string[]) => {
    calls.push([program, ...args]);
    if (args[0] === 'query' && !there) throw new Error('not found');
    if (args[0] === 'add') there = true;
    if (args[0] === 'delete') there = false;
    return '';
  };
  await setAutostart(false, release!, run);
  assert.deepEqual(calls.map((call) => call[1]), ['query'], 'turning off what is not on deletes nothing');
  await setAutostart(true, release!, run);
  assert.deepEqual(calls.at(-1), ['reg.exe', 'add', RUN_KEY, '/v', RUN_VALUE, '/t', 'REG_SZ', '/d', release!.kind === 'registry' ? release!.command : '', '/f']);
  assert.ok(RUN_KEY.startsWith('HKCU\\'), 'the user\'s own key: no administrator rights');
  await setAutostart(false, release!, run);
  assert.deepEqual(calls.at(-1), ['reg.exe', 'delete', RUN_KEY, '/v', RUN_VALUE, '/f']);
});

test('on Linux it is a desktop entry in the user\'s autostart folder', async () => {
  const configHome = join(dir, 'config');
  const plan = autostartPlan({ platform: 'linux', managerDir: '/opt/my $apps/proteus/manager', nodePath: '/usr/bin/node', configHome, exists: () => true });
  assert.ok(plan?.kind === 'desktop');
  assert.equal(plan.file, join(configHome, 'autostart', 'proteus.desktop'));
  await setAutostart(true, plan);
  const text = await readFile(plan.file, 'utf8');
  assert.match(text, /^\[Desktop Entry\]\nType=Application\nName=Proteus\n/);
  assert.ok(text.includes('start-proteus.sh"\n'), text);
  assert.ok(text.includes('my \\$apps'), 'a dollar sign in the path is not the shell\'s');
  await setAutostart(false, plan);
  await assert.rejects(readFile(plan.file, 'utf8'));
  await setAutostart(false, plan);   // Off twice is fine.
});

test('a system without such a start has no plan', () => {
  assert.equal(autostartPlan({ platform: 'darwin', managerDir: '/Applications/Proteus/manager', nodePath: '/usr/bin/node' }), null);
});

// Getting a newer release and putting it in: a pretend release is packed the way the
// real ones are, handed out by a pretend GitHub, fetched, checked, unpacked and then
// put over a pretend program folder by the real script.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, generateKeyPairSync, type KeyObject, sign } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';

import { assetName, checkForUpdate, DOWNLOAD_PREFIX } from '../src/update.ts';
import { signedBy } from '../src/releaseKey.ts';
import { Updater } from '../src/updater.ts';

const windows = process.platform === 'win32';
const supported = windows || process.platform === 'linux';
const root = mkdtempSync(join(tmpdir(), 'proteus-updater-'));
after(() => rmSync(root, { recursive: true, force: true }));

const kernelName = windows ? 'chrome.exe' : 'chrome';
const startName = windows ? 'Start Proteus.cmd' : 'start-proteus.sh';

/** A Proteus folder of `version` under `parent`, small, whose start script leaves a mark. */
function makeFolder(parent: string, version: string, extra: Record<string, string> = {}): string {
  const folder = join(parent, 'Proteus');
  for (const dir of ['manager/src', 'kernel', 'node', 'licenses']) mkdirSync(join(folder, dir), { recursive: true });
  writeFileSync(join(folder, 'VERSION.txt'), `${version}\n`);
  writeFileSync(join(folder, 'manager', 'src', 'main.ts'), `// ${version}\n`);
  writeFileSync(join(folder, 'kernel', kernelName), `kernel of ${version}`);
  writeFileSync(join(folder, 'licenses', 'LICENSE.txt'), version);
  writeFileSync(join(folder, startName), windows
      ? `@echo off\r\necho started ${version}> "%~dp0started.txt"\r\n`
      : `#!/bin/sh\necho "started ${version}" > "$(dirname "$0")/started.txt"\n`, { mode: 0o755 });
  for (const [name, text] of Object.entries(extra)) writeFileSync(join(folder, name), text);
  return folder;
}

/** Packs a folder made by makeFolder as a release packs it; returns the file's bytes. */
function pack(parent: string, version: string): Buffer {
  const name = assetName(version, process.platform)!;
  const file = join(parent, name);
  if (windows) {
    execFileSync(join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe'), ['-a', '-cf', file, '-C', parent, 'Proteus']);
  } else {
    execFileSync('tar', ['-cJf', file, '-C', parent, 'Proteus']);
  }
  return readFileSync(file);
}

/** A pretend GitHub with one release, and what was asked of it. */
function github(version: string, archive: Buffer, sums?: string, signature?: string) {
  const name = assetName(version, process.platform)!;
  const base = `${DOWNLOAD_PREFIX}v${version}/`;
  const listed = sums ?? `${createHash('sha256').update(archive).digest('hex')}  ${name}\n`;
  const asked: string[] = [];
  const fetcher = (async (url: string | URL | Request) => {
    asked.push(String(url));
    if (String(url) === base + name) return new Response(new Uint8Array(archive));
    if (String(url) === base + 'SHA256SUMS.txt') return new Response(listed);
    if (String(url) === base + 'SHA256SUMS.txt.sig' && signature !== undefined) return new Response(signature);
    return new Response(JSON.stringify([{
      tag_name: `v${version}`, html_url: `https://github.com/Sheekovic/Proteus-Browser/releases/tag/v${version}`,
      assets: [
        { name, size: archive.length, browser_download_url: base + name },
        { name: 'SHA256SUMS.txt', size: listed.length, browser_download_url: base + 'SHA256SUMS.txt' },
        ...(signature !== undefined ? [{ name: 'SHA256SUMS.txt.sig', size: signature.length, browser_download_url: base + 'SHA256SUMS.txt.sig' }] : []),
        { name: 'elsewhere.zip', size: 1, browser_download_url: 'https://example.com/elsewhere.zip' },
      ],
    }]));
  }) as typeof fetch;
  return { fetcher, asked, listed };
}

test('a release names its file for this system only when it is where releases are', async () => {
  const release = (url: string) => [{
    tag_name: 'v0.2.0', assets: [
      { name: 'Proteus-0.2.0-win-x64.zip', size: 10, browser_download_url: url },
      { name: 'SHA256SUMS.txt', size: 1, browser_download_url: `${DOWNLOAD_PREFIX}v0.2.0/SHA256SUMS.txt` },
    ],
  }];
  const answering = (body: unknown) => (async () => new Response(JSON.stringify(body))) as typeof fetch;
  const good = await checkForUpdate('0.1.0', answering(release(`${DOWNLOAD_PREFIX}v0.2.0/Proteus-0.2.0-win-x64.zip`)), 'win32');
  assert.equal(good.download?.name, 'Proteus-0.2.0-win-x64.zip');
  assert.equal(good.download?.size, 10);
  const elsewhere = await checkForUpdate('0.1.0', answering(release('https://example.com/Proteus-0.2.0-win-x64.zip')), 'win32');
  assert.equal(elsewhere.download, null, 'a file named on another site is not taken');
  const linux = await checkForUpdate('0.1.0', answering(release(`${DOWNLOAD_PREFIX}v0.2.0/Proteus-0.2.0-win-x64.zip`)), 'linux');
  assert.equal(linux.download, null, 'the release has no file for Linux');
  const mac = await checkForUpdate('0.1.0', answering(release('x')), 'darwin');
  assert.equal(mac.download, null);
});

test('what cannot be updated says why', () => {
  const tree = join(root, 'tree');
  mkdirSync(join(tree, 'manager'), { recursive: true });
  const none = new Updater({ managerDir: join(tree, 'manager'), dataDir: join(root, 'tree-data') });
  assert.equal(none.status().canUpdate, false);
  assert.match(none.status().why, /not a release folder/);

  const inside = makeFolder(join(root, 'inside'), '0.1.0');
  const nested = new Updater({ managerDir: join(inside, 'manager'), dataDir: join(inside, 'data'), platform: 'win32' });
  assert.match(nested.status().why, /data folder is inside the program folder/);
  const mac = new Updater({ managerDir: join(inside, 'manager'), dataDir: join(root, 'mac-data'), platform: 'darwin' });
  assert.match(mac.status().why, /no release for this system/);
  const fine = new Updater({ managerDir: join(inside, 'manager'), dataDir: join(root, 'fine-data'), platform: 'win32' });
  assert.deepEqual([fine.status().canUpdate, fine.status().why, fine.status().state], [true, '', 'idle']);
});

test('a file that is not the one the release lists is thrown away', { skip: !supported }, async () => {
  const installed = makeFolder(join(root, 'bad', 'installed'), '0.1.0');
  const archive = pack(join(root, 'bad', 'new'), (makeFolder(join(root, 'bad', 'new'), '0.2.0'), '0.2.0'));
  const dataDir = join(root, 'bad', 'data');
  const { fetcher } = github('0.2.0', archive, `${'0'.repeat(64)}  ${assetName('0.2.0', process.platform)}\n`);
  const updater = new Updater({ managerDir: join(installed, 'manager'), dataDir, fetcher, releaseKeys: [] });
  await updater.prepare();
  await updater.settled();
  assert.equal(updater.status().state, 'failed');
  assert.match(updater.status().message, /checksum/);
  assert.equal(existsSync(join(dataDir, 'update', '0.2.0')), false, 'nothing of it is kept');
  await assert.rejects(updater.apply(1), /No update is ready/);
});

test('a Proteus that knows a release key takes only a release that key signed', { skip: !supported }, async () => {
  const pair = () => {
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    const der = publicKey.export({ format: 'der', type: 'spki' });
    return { privateKey, known: der.subarray(der.length - 32).toString('base64') };
  };
  const maker = pair(), other = pair();
  const installed = makeFolder(join(root, 'signed', 'installed'), '0.1.0');
  const archive = pack(join(root, 'signed', 'new'), (makeFolder(join(root, 'signed', 'new'), '0.2.0'), '0.2.0'));
  const listed = github('0.2.0', archive).listed;
  const signatureOf = (key: KeyObject) => sign(null, Buffer.from(listed), key).toString('base64') + '\n';

  assert.equal(signedBy(listed, signatureOf(maker.privateKey), [maker.known]), true);
  assert.equal(signedBy(listed, signatureOf(maker.privateKey), [other.known, maker.known]), true, 'any key it knows');
  assert.equal(signedBy(listed + ' ', signatureOf(maker.privateKey), [maker.known]), false, 'of this list, to the byte');
  assert.equal(signedBy(listed, signatureOf(other.privateKey), [maker.known]), false);
  assert.equal(signedBy(listed, 'not a signature', [maker.known]), false);
  assert.equal(signedBy(listed, signatureOf(maker.privateKey), []), false);

  const attempt = async (name: string, signature: string | undefined) => {
    const { fetcher } = github('0.2.0', archive, undefined, signature);
    const updater = new Updater({ managerDir: join(installed, 'manager'), dataDir: join(root, 'signed', name), fetcher, releaseKeys: [maker.known] });
    await updater.prepare();
    await updater.settled();
    return updater.status();
  };
  const unsigned = await attempt('unsigned', undefined);
  assert.deepEqual([unsigned.state, /not signed/.test(unsigned.message)], ['failed', true], unsigned.message);
  const forged = await attempt('forged', signatureOf(other.privateKey));
  assert.deepEqual([forged.state, /not signed with the key/.test(forged.message)], ['failed', true], forged.message);
  assert.equal(existsSync(join(root, 'signed', 'forged', 'update', '0.2.0')), false, 'nothing of it is kept');
  assert.equal((await attempt('good', signatureOf(maker.privateKey))).state, 'ready');
});

test('a release of another version than it says is not made ready', { skip: !supported }, async () => {
  const installed = makeFolder(join(root, 'liar', 'installed'), '0.1.0');
  makeFolder(join(root, 'liar', 'new'), '0.1.5');
  // Packed under the name of 0.2.0, holding 0.1.5.
  const name = assetName('0.2.0', process.platform)!;
  const file = join(root, 'liar', 'new', name);
  if (windows) execFileSync(join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe'), ['-a', '-cf', file, '-C', join(root, 'liar', 'new'), 'Proteus']);
  else execFileSync('tar', ['-cJf', file, '-C', join(root, 'liar', 'new'), 'Proteus']);
  const { fetcher } = github('0.2.0', readFileSync(file));
  const updater = new Updater({ managerDir: join(installed, 'manager'), dataDir: join(root, 'liar', 'data'), fetcher, releaseKeys: [] });
  await updater.prepare();
  await updater.settled();
  assert.equal(updater.status().state, 'failed');
  assert.match(updater.status().message, /not version 0\.2\.0/);
});

test('a newer release is fetched, checked, unpacked, and put in by the script, which starts Proteus again',
    { skip: !supported, timeout: 120_000 }, async () => {
  const installed = makeFolder(join(root, 'good', 'installed'), '0.1.0', { 'installed.txt': 'an install made this', 'mine.txt': 'kept' });
  writeFileSync(join(installed, 'kernel', 'gone-in-the-new-one.pak'), 'old');
  makeFolder(join(root, 'good', 'new'), '0.2.0', { 'README.txt': 'new readme' });
  const archive = pack(join(root, 'good', 'new'), '0.2.0');
  const dataDir = join(root, 'good', 'data');
  const { fetcher, asked } = github('0.2.0', archive);
  const updater = new Updater({ managerDir: join(installed, 'manager'), dataDir, fetcher, releaseKeys: [] });

  assert.equal((await updater.check()).newer, true);
  const begun = await updater.prepare();
  assert.equal(begun.version, '0.2.0');
  assert.equal(begun.total, archive.length);
  await updater.settled();
  const ready = updater.status();
  assert.deepEqual([ready.state, ready.received], ['ready', archive.length], ready.message);
  assert.equal(asked.length, 3, 'the list, the file and the checksums: nothing else');
  assert.equal(readFileSync(join(installed, 'VERSION.txt'), 'utf8').trim(), '0.1.0', 'nothing is put in before it is asked for');
  // Asked again, it does not fetch again; nor does another manager started later.
  await updater.prepare();
  const later = new Updater({ managerDir: join(installed, 'manager'), dataDir, fetcher, releaseKeys: [] });
  await later.check();
  assert.equal(later.status().state, 'ready');
  assert.equal(asked.length, 4, 'one more look at the list, no second download');

  // The process the script waits for has ended already.
  await updater.apply(999_999_999);
  for (let i = 0; i < 300 && !existsSync(join(installed, 'started.txt')); i++) await delay(200);
  const log = updater.lastLog();
  assert.ok(existsSync(join(installed, 'started.txt')), `Proteus was started again; the script wrote:\n${log}`);
  assert.match(readFileSync(join(installed, 'started.txt'), 'utf8'), /started 0\.2\.0/);
  assert.equal(readFileSync(join(installed, 'VERSION.txt'), 'utf8').trim(), '0.2.0');
  assert.equal(readFileSync(join(installed, 'kernel', kernelName), 'utf8'), 'kernel of 0.2.0');
  assert.equal(readFileSync(join(installed, 'manager', 'src', 'main.ts'), 'utf8'), '// 0.2.0\n');
  assert.equal(existsSync(join(installed, 'kernel', 'gone-in-the-new-one.pak')), false, 'what the new kernel no longer has is gone');
  assert.equal(readFileSync(join(installed, 'README.txt'), 'utf8'), 'new readme');
  assert.equal(readFileSync(join(installed, 'installed.txt'), 'utf8'), 'an install made this', "the install's note stays");
  assert.equal(readFileSync(join(installed, 'mine.txt'), 'utf8'), 'kept', "someone's own file stays");
  assert.match(log, /done: this is now 0\.2\.0/);
  for (let i = 0; i < 50 && existsSync(join(dataDir, 'update', '0.2.0')); i++) await delay(100);
  assert.equal(existsSync(join(dataDir, 'update', '0.2.0')), false, 'what was unpacked is cleared away');

  // The manager that starts next is the new version: nothing newer, and nothing left over.
  const next = new Updater({ managerDir: join(installed, 'manager'), dataDir, fetcher, releaseKeys: [] });
  await next.tidy();
  assert.equal((await next.check()).newer, false);
  assert.equal(existsSync(join(dataDir, 'update', windows ? 'apply.ps1' : 'apply.sh')), false);
});

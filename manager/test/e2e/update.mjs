// The whole of an update, with a real manager process: a pretend release folder runs
// this manager, a pretend GitHub on this machine offers a newer one, and the manager
// is asked over its API to fetch it and put it in. The manager has to end, the script
// it left has to outlive it, replace the folder and start Proteus again.
//
// usage: node update.mjs            (Windows or Linux; nothing is fetched from the internet)

import { execFileSync, spawn } from 'node:child_process';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const windows = process.platform === 'win32';
const managerSource = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const root = mkdtempSync(join(tmpdir(), 'proteus-update-e2e-'));
const PORT = 5322;
let failed = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : ` ${detail}`}`); if (!ok) failed++; };

function makeFolder(parent, version) {
  const folder = join(parent, 'Proteus');
  for (const dir of ['manager', 'kernel', 'node', 'licenses']) mkdirSync(join(folder, dir), { recursive: true });
  for (const part of ['src', 'ui', 'package.json']) cpSync(join(managerSource, part), join(folder, 'manager', part), { recursive: true });
  writeFileSync(join(folder, 'VERSION.txt'), `${version}\n`);
  // Never started here: the manager is run without its window.
  writeFileSync(join(folder, 'kernel', windows ? 'chrome.exe' : 'chrome'), `not a browser (${version})`);
  writeFileSync(join(folder, windows ? 'Start Proteus.cmd' : 'start-proteus.sh'), windows
      ? `@echo off\r\necho started ${version}> "%~dp0started.txt"\r\n`
      : `#!/bin/sh\necho "started ${version}" > "$(dirname "$0")/started.txt"\n`, { mode: 0o755 });
  return folder;
}

const installed = makeFolder(join(root, 'installed'), '0.0.1');
makeFolder(join(root, 'new'), '0.0.2');
const name = windows ? 'Proteus-0.0.2-win-x64.zip' : 'Proteus-0.0.2-linux-x64.tar.xz';
const archiveFile = join(root, name);
if (windows) execFileSync(join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe'), ['-a', '-cf', archiveFile, '-C', join(root, 'new'), 'Proteus']);
else execFileSync('tar', ['-cJf', archiveFile, '-C', join(root, 'new'), 'Proteus']);
const archive = readFileSync(archiveFile);
const sums = `${createHash('sha256').update(archive).digest('hex')}  ${name}\n`;
// Signed, as a release is, with a key made for this trial.
const trialKey = generateKeyPairSync('ed25519');
const trialPublic = trialKey.publicKey.export({ format: 'der', type: 'spki' }).subarray(-32).toString('base64');
const signature = sign(null, Buffer.from(sums), trialKey.privateKey).toString('base64') + '\n';

// The pretend GitHub.
const asked = [];
const github = createServer((request, response) => {
  asked.push(request.url);
  const origin = `http://127.0.0.1:${github.address().port}`;
  if (request.url === '/releases') {
    response.setHeader('Content-Type', 'application/json');
    return response.end(JSON.stringify([{
      tag_name: 'v0.0.2', html_url: 'https://github.com/Sheekovic/Proteus-Browser/releases/tag/v0.0.2',
      assets: [
        { name, size: archive.length, browser_download_url: `${origin}/files/${name}` },
        { name: 'SHA256SUMS.txt', size: sums.length, browser_download_url: `${origin}/files/SHA256SUMS.txt` },
        { name: 'SHA256SUMS.txt.sig', size: signature.length, browser_download_url: `${origin}/files/SHA256SUMS.txt.sig` },
      ],
    }]));
  }
  if (request.url === `/files/${name}`) return response.end(archive);
  if (request.url === '/files/SHA256SUMS.txt') return response.end(sums);
  if (request.url === '/files/SHA256SUMS.txt.sig') return response.end(signature);
  response.writeHead(404).end();
});
await new Promise((listening) => github.listen(0, '127.0.0.1', listening));

const base = `http://127.0.0.1:${PORT}`;
const api = async (method, path, body) => {
  const response = await fetch(base + path, {
    method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(10_000),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : undefined };
};
const until = async (what, seconds = 30) => {
  for (let i = 0; i < seconds * 5; i++) { try { const got = await what(); if (got) return got; } catch { /* not yet */ } await delay(200); }
  return null;
};

const manager = spawn(process.execPath, [join(installed, 'manager', 'src', 'main.ts'), '--port', String(PORT)], {
  env: { ...process.env, PROTEUS_HOME: join(root, 'data'), PROTEUS_KERNEL: '', PROTEUS_RELEASES_URL: `http://127.0.0.1:${github.address().port}/releases`,
         PROTEUS_RELEASE_KEY: trialPublic },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let output = '';
manager.stdout.on('data', (data) => { output += data; });
manager.stderr.on('data', (data) => { output += data; });
let exited = null;
manager.once('exit', (code) => { exited = code ?? 0; });

try {
  check('the manager of version 0.0.1 is up', await until(async () => (await api('GET', '/api/health')).status === 200));
  // Nobody asked: the manager looked by itself at its start.
  const found = await until(async () => { const s = (await api('GET', '/api/update/status')).body; return s.report?.newer ? s : null; });
  check('it found the newer release by itself', found !== null && found.report.latest === '0.0.2' && found.canUpdate, JSON.stringify(found));
  check('and fetched nothing yet', asked.length === 1 && asked[0] === '/releases', JSON.stringify(asked));

  const early = await api('POST', '/api/update/apply', {});
  check('putting in what is not ready is refused', early.status === 409, JSON.stringify(early));

  const begun = await api('POST', '/api/update/download', {});
  check('the download is taken on', begun.status === 202 && begun.body.version === '0.0.2', JSON.stringify(begun));
  const ready = await until(async () => { const s = (await api('GET', '/api/update/status')).body; return ['ready', 'failed'].includes(s.state) ? s : null; }, 60);
  check('it is made ready', ready?.state === 'ready' && ready.received === archive.length, JSON.stringify(ready));
  check('the folder in use is still 0.0.1', readFileSync(join(installed, 'VERSION.txt'), 'utf8').trim() === '0.0.1');

  const applied = await api('POST', '/api/update/apply', {});
  check('putting it in is taken on', applied.status === 200, JSON.stringify(applied));
  check('the manager ends by itself', await until(() => exited !== null, 30) !== null, output);
  check('Proteus is started again, by the script the manager left', await until(() => existsSync(join(installed, 'started.txt')), 90) !== null,
      (() => { try { return readFileSync(join(root, 'data', 'update', 'apply.log'), 'utf8'); } catch { return 'no log'; } })());
  check('and it is version 0.0.2', readFileSync(join(installed, 'VERSION.txt'), 'utf8').trim() === '0.0.2' &&
      /started 0\.0\.2/.test(readFileSync(join(installed, 'started.txt'), 'utf8')));
  check('settings made before are still there', existsSync(join(root, 'data', 'settings.json')));
} finally {
  if (exited === null) manager.kill();
  github.close();
  await delay(500);
  try { rmSync(root, { recursive: true, force: true }); } catch { /* a file still in use */ }
}
console.log(failed === 0 ? 'UPDATE-E2E-OK' : `UPDATE-E2E-FAIL (${failed})`);
process.exit(failed === 0 ? 0 : 1);

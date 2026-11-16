// Starts the manager, creates a throwaway profile, launches the kernel for it and
// prints what the given test pages report in it. Used to score a manager-generated
// profile on the detector page (kernel/tests/detect.html).
//
// usage: node probe-profile.mjs <kernel executable> <pages base URL> <os> <page>[,<page>...] [extra kernel args...]
//        node probe-profile.mjs <kernel executable> sites <os> all|<site>[,<site>...] [extra kernel args...]
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const [kernelPath, pagesUrl, os, pages, ...extraArgs] = process.argv.slice(2);
const here = dirname(fileURLToPath(import.meta.url));
const managerDir = join(here, '..', '..');
const dataDir = mkdtempSync(join(tmpdir(), 'proteus-probe-'));
const PORT = 5312;
const base = `http://127.0.0.1:${PORT}`;

async function api(method, path, body) {
  const response = await fetch(base + path, {
    method,
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${method} ${path} -> ${response.status}: ${text}`);
  return text ? JSON.parse(text) : undefined;
}

const manager = spawn(process.execPath, [join(managerDir, 'src', 'main.ts'), '--port', String(PORT)], {
  env: { ...process.env, PROTEUS_HOME: dataDir }, stdio: 'ignore',
});
let id;
try {
  for (let i = 0; i < 50; i++) {
    try { await api('GET', '/api/health'); break; } catch { await delay(100); }
  }
  await api('PUT', '/api/settings', { kernelPath, extraArgs });
  // PROFILE_JSON may hold extra profile fields, e.g. '{"noise":{"canvas":false,"audio":false}}'.
  const profile = await api('POST', '/api/profiles',
                            { name: 'Probe', os, ...JSON.parse(process.env.PROFILE_JSON || '{}') });
  id = profile.id;
  console.log(`profile: ${profile.userAgent}`);
  console.log(`         ${profile.screen.width}x${profile.screen.height}, ${profile.webgl.renderer}`);
  const status = await api('POST', `/api/profiles/${id}/start`);
  await delay(3000);  // Let the kernel finish starting before opening tabs.
  const version = await (await fetch(`${status.debuggerUrl}/json/version`)).json();
  // "sites" in place of a pages URL runs the public detection sites instead
  // (kernel/tests/probe-sites.mjs); the page list then names sites, or "all".
  const tests = join(managerDir, '..', 'kernel', 'tests');
  const command = pagesUrl === 'sites'
      ? [join(tests, 'probe-sites.mjs'), version.webSocketDebuggerUrl, ...pages.split(',').filter((p) => p !== 'all')]
      : [join(tests, 'probe-browser.mjs'), version.webSocketDebuggerUrl, pagesUrl, ...pages.split(',')];
  spawnSync(process.execPath, command, { stdio: 'inherit' });
} finally {
  if (id) {
    await api('POST', `/api/profiles/${id}/stop`).catch(() => {});
    await api('DELETE', `/api/profiles/${id}`).catch(() => {});
  }
  manager.kill('SIGTERM');
  await delay(1500);
  rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}

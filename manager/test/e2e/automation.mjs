// What a page can tell when a profile is driven by Puppeteer, Playwright or Selenium.
//
// Starts the manager and a profile, then opens automation.html four times: read over
// the bare debugging protocol (what the manager's own browser control does), driven by
// Puppeteer, by Playwright, and through a WebDriver driver program, which is what
// Selenium drives a browser with; each connects to the profile's running browser,
// which is how a profile is meant to be automated. Prints what the page saw each time.
//
// usage: node automation.mjs <kernel executable> <directory with node_modules> [driver program] [extra kernel args...]
//   The directory has puppeteer-core and playwright-core installed
//   (npm install puppeteer-core playwright-core); neither downloads a browser.
//   Either may be missing: its part is skipped.
//   The driver program is the chromedriver of the kernel's own version (the build
//   makes one: target "chromedriver"); "-" or nothing skips that part. It is spoken
//   to as Selenium speaks to it, in WebDriver's own HTTP, so Selenium itself is not
//   needed.

import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const [kernelPath, librariesDir, driverPath = '-', ...extraArgs] = process.argv.slice(2);
if (!kernelPath || !librariesDir) {
  console.error('usage: automation.mjs <kernel executable> <directory with node_modules> [driver program] [extra kernel args...]');
  process.exit(2);
}
const here = dirname(fileURLToPath(import.meta.url));
const managerDir = join(here, '..', '..');
const PORT = 5314;
const base = `http://127.0.0.1:${PORT}`;
const requireFrom = createRequire(join(librariesDir, 'package.json'));
const load = (name) => { try { return requireFrom(name); } catch { return null; } };

// The page is served over HTTP: some of what it reads differs on a file: page.
const page = readFileSync(join(here, 'automation.html'));
const pages = createServer((request, response) => {
  response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  response.end(page);
});
await new Promise((resolve) => pages.listen(0, '127.0.0.1', resolve));
const pageUrl = `http://127.0.0.1:${pages.address().port}/automation.html`;

async function api(method, path, body) {
  const response = await fetch(base + path, {
    method, headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${method} ${path} -> ${response.status}: ${text}`);
  return text ? JSON.parse(text) : undefined;
}

let failures = 0;
/** A value as text with its keys in order: a driver may hand an object back with them sorted. */
const ordered = (value) => JSON.stringify(value, (_, part) =>
    part && typeof part === 'object' && !Array.isArray(part) ? Object.fromEntries(Object.entries(part).sort(([a], [b]) => a.localeCompare(b))) : part);

function check(name, actual, expected) {
  if (ordered(actual) === ordered(expected)) console.log(`ok   ${name}`);
  else { console.log(`FAIL ${name}\n       got:      ${JSON.stringify(actual)}\n       expected: ${JSON.stringify(expected)}`); failures++; }
}

/** The checks that hold however the page is driven. `clicked` is false when nothing clicked. */
function judge(how, signals, baseline, clicked) {
  check(`${how}: navigator.webdriver`, signals.webdriver, false);
  check(`${how}: nothing logged was read by a debugger client`, signals.serialised, 0);
  check(`${how}: no names left on the page`, signals.globals, []);
  check(`${how}: the tab is on show as its page starts`, signals.visibleAtStart, 'visible');
  // Not judged: the window's size as the page starts. It reads 0 by 0 in any tab that
  // has just moved to another site, a person's click on a link included, until the
  // browser tells the new page's process where its window is.
  if (baseline) {
    check(`${how}: the page area, pixel ratio and screen are the profile's own`, signals.viewLater, baseline.viewLater);
  }
  if (clicked) {
    check(`${how}: the click is the browser's own`, signals.click?.trusted, true);
    const [cx, cy] = signals.click?.client ?? [];
    const [sx, sy] = signals.click?.screen ?? [];
    // On the screen a point of the page is offset by where the window is and by the
    // browser's own bars: a click reported at the page's coordinates gives it away.
    check(`${how}: the click is placed on the screen, not at the page's coordinates`, sx !== cx || sy !== cy, true);
    check(`${how}: the pointer moved before it clicked`, (signals.moves ?? 0) > 0, true);
  }
}

const dataDir = mkdtempSync(join(tmpdir(), 'proteus-automation-'));
const manager = spawn(process.execPath, [join(managerDir, 'src', 'main.ts'), '--port', String(PORT)], {
  env: { ...process.env, PROTEUS_HOME: dataDir }, stdio: 'ignore',
});
try {
  for (let i = 0; i < 50; i++) { try { await api('GET', '/api/health'); break; } catch { await delay(100); } }
  await api('PUT', '/api/settings', { kernelPath, extraArgs, exitLookupUrl: '' });
  const profile = await api('POST', '/api/profiles', { name: 'Automation', os: 'windows' });
  const status = await api('POST', `/api/profiles/${profile.id}/start`);
  const version = await (await fetch(`${status.debuggerUrl}/json/version`)).json();
  console.log(`kernel: ${version.Browser}`);

  // --- The bare protocol: one command, nothing switched on -----------------------------
  const tab = await (await fetch(`${status.debuggerUrl}/json/new?${encodeURIComponent(pageUrl)}`, { method: 'PUT' })).json();
  await delay(2000);
  const socket = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((resolve) => socket.addEventListener('open', resolve, { once: true }));
  const reply = await new Promise((resolve) => {
    socket.addEventListener('message', (event) => resolve(JSON.parse(event.data)), { once: true });
    socket.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression: 'JSON.stringify(window.signals)', returnByValue: true } }));
  });
  socket.close();
  const baseline = JSON.parse(reply.result.result.value);
  judge('bare protocol', baseline, null, false);
  await fetch(`${status.debuggerUrl}/json/close/${tab.id}`);

  // --- Puppeteer ----------------------------------------------------------------------
  const puppeteer = load('puppeteer-core');
  if (!puppeteer) {
    console.log('skip Puppeteer: puppeteer-core is not installed');
  } else {
    // defaultViewport: null leaves the window as it is; Puppeteer's default would
    // set the page area to 800 by 600.
    const browser = await puppeteer.connect({ browserURL: status.debuggerUrl, defaultViewport: null });
    const tabPage = await browser.newPage();
    await tabPage.goto(pageUrl);
    await delay(1200);
    await tabPage.click('#target');
    await tabPage.evaluate(() => window.whoCalls());
    await delay(600);
    const signals = await tabPage.evaluate(() => window.signals);
    judge('Puppeteer', signals, baseline, true);
    console.log(`info Puppeteer: a page function it calls sees this caller: ${JSON.stringify((signals.stack ?? '').split('\n').slice(1, 3).map((line) => line.trim()))}`);
    console.log(`info Puppeteer: click at page ${signals.click?.client}, screen ${signals.click?.screen}; window at ${signals.click?.windowAt}, bars ${signals.click?.chrome}`);
    await tabPage.close();
    await browser.disconnect();
  }

  // --- Playwright ---------------------------------------------------------------------
  const playwright = load('playwright-core');
  if (!playwright) {
    console.log('skip Playwright: playwright-core is not installed');
  } else {
    const browser = await playwright.chromium.connectOverCDP(status.debuggerUrl);
    const context = browser.contexts()[0];
    const tabPage = await context.newPage();
    await tabPage.goto(pageUrl);
    await delay(1200);
    await tabPage.click('#target');
    await tabPage.evaluate(() => window.whoCalls());
    await delay(600);
    const signals = await tabPage.evaluate(() => window.signals);
    judge('Playwright', signals, baseline, true);
    console.log(`info Playwright: a page function it calls sees this caller: ${JSON.stringify((signals.stack ?? '').split('\n').slice(1, 3).map((line) => line.trim()))}`);
    console.log(`info Playwright: click at page ${signals.click?.client}, screen ${signals.click?.screen}; window at ${signals.click?.windowAt}, bars ${signals.click?.chrome}`);
    await tabPage.close();
    await browser.close();   // For a browser it connected to, this only disconnects.
  }

  // --- Selenium: a WebDriver driver program attached to the running browser ------------
  if (driverPath === '-') {
    console.log('skip Selenium: no driver program was given');
  } else {
    const driverPort = 9500 + Math.floor(Math.random() * 400);
    const driver = spawn(driverPath, [`--port=${driverPort}`], { stdio: 'ignore' });
    const wd = async (method, path, body) => {
      const response = await fetch(`http://127.0.0.1:${driverPort}${path}`, {
        method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
      const answer = await response.json();
      if (!response.ok) throw new Error(`driver: ${method} ${path} -> ${JSON.stringify(answer.value).slice(0, 300)}`);
      return answer.value;
    };
    try {
      for (let i = 0; i < 50; i++) { try { await wd('GET', '/status'); break; } catch { await delay(100); } }
      // As Selenium attaches to a browser that is already running: by its debugger address.
      const session = await wd('POST', '/session', { capabilities: { alwaysMatch: {
        'goog:chromeOptions': { debuggerAddress: new URL(status.debuggerUrl).host } } } });
      const at = `/session/${session.sessionId}`;
      const opened = await wd('POST', `${at}/window/new`, { type: 'tab' });
      await wd('POST', `${at}/window`, { handle: opened.handle });
      await wd('POST', `${at}/url`, { url: pageUrl });
      await delay(1200);
      const element = await wd('POST', `${at}/element`, { using: 'css selector', value: '#target' });
      await wd('POST', `${at}/element/${Object.values(element)[0]}/click`, {});
      await wd('POST', `${at}/execute/sync`, { script: 'return window.whoCalls();', args: [] });
      await delay(600);
      const signals = await wd('POST', `${at}/execute/sync`, { script: 'return window.signals;', args: [] });
      judge('Selenium', signals, baseline, true);
      console.log(`info Selenium: a page function it calls sees this caller: ${JSON.stringify((signals.stack ?? '').split('\n').slice(1, 3).map((line) => line.trim()))}`);
      console.log(`info Selenium: click at page ${signals.click?.client}, screen ${signals.click?.screen}; window at ${signals.click?.windowAt}, bars ${signals.click?.chrome}`);
      await wd('DELETE', `${at}/window`);
      // Ending the session of a browser the driver attached to leaves the browser running.
      await wd('DELETE', at);
    } finally {
      driver.kill();
    }
  }

  check('the profile is still running after the libraries disconnected', (await api('GET', `/api/profiles/${profile.id}`)).state, 'running');
  await api('POST', `/api/profiles/${profile.id}/stop`);
  await api('DELETE', `/api/profiles/${profile.id}`);
} finally {
  manager.kill();
  pages.close();
}
console.log(failures === 0 ? 'AUTOMATION-OK' : `AUTOMATION-FAILED ${failures}`);
process.exit(failures === 0 ? 0 : 1);

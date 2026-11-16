// Opens public browser-detection pages in an already running browser, through its
// DevTools browser endpoint, and prints the verdict each page shows. The pages are
// third-party sites: they see the browser exactly as any site would, which makes them
// an independent check next to this project's own detect.html.
//
// usage: node probe-sites.mjs <browser websocket URL> [site ...]     (default: all)
import { setTimeout as delay } from 'node:timers/promises';

const SITES = {
  // A table of classic automation and headless tells; each cell is marked passed/failed.
  sannysoft: {
    url: 'https://bot.sannysoft.com/',
    waitMs: 14000,
    read: `(() => {
      const cells = [...document.querySelectorAll('td')];
      const failed = cells.filter(td => /failed/.test(td.className)).map(td => (td.previousElementSibling || td).innerText.trim().split('\\n')[0]);
      const warned = cells.filter(td => /warn/.test(td.className)).map(td => (td.previousElementSibling || td).innerText.trim().split('\\n')[0]);
      const passed = cells.filter(td => /passed/.test(td.className)).length;
      return 'passed=' + passed + ' failed=' + failed.length + (failed.length ? ' [' + failed.join('; ') + ']' : '') +
             ' warnings=' + warned.length + (warned.length ? ' [' + warned.join('; ') + ']' : '');
    })()`,
  },
  // Looks for contradictions ("lies") between the values a browser reports.
  creepjs: {
    url: 'https://abrahamjuliot.github.io/creepjs/',
    waitMs: 45000,
    read: `(() => {
      const text = document.body.innerText;
      const pick = re => (re.exec(text) || [])[0] || '';
      const lines = text.split('\\n').map(l => l.trim()).filter(l => /lies|trash|bot|stealth|like headless|headless:|privacy|resist|blocked|prototype/i.test(l) && l.length < 90);
      return [...new Set(lines)].slice(0, 28).join(' | ');
    })()`,
  },
  // Rates how authentic the fingerprint looks and lists what it finds wrong.
  browserscan: {
    url: 'https://www.browserscan.net/',
    waitMs: 30000,
    read: `(() => {
      const text = document.body.innerText;
      const lines = text.split('\\n').map(l => l.trim()).filter(Boolean);
      const out = [];
      lines.forEach((l, i) => { if (/authenticity|^\\d{1,3}%$|bot detection|abnormal|inconsisten|different from|does not match|is being used|leak/i.test(l) && l.length < 120) out.push(l); });
      return [...new Set(out)].slice(0, 24).join(' | ');
    })()`,
  },
  // Made for checking anti-detect browsers: is the fingerprint consistent, is it masked.
  pixelscan: {
    url: 'https://pixelscan.net/fingerprint-check',
    waitMs: 60000,
    read: `(() => {
      const lines = document.body.innerText.split('\\n').map(l => l.trim()).filter(Boolean);
      const out = lines.filter(l => /fingerprint is|masking|automated behavior|proxy detected|inconsisten/i.test(l) && l.length < 90);
      return [...new Set(out)].slice(0, 8).join(' | ');
    })()`,
  },
  // Rates the identity "trustworthy" or not against a database of real fingerprints.
  iphey: {
    url: 'https://iphey.com/',
    waitMs: 60000,
    read: `(() => {
      const lines = document.body.innerText.split('\\n').map(l => l.trim()).filter(Boolean);
      const at = name => { const i = lines.indexOf(name); return i >= 0 ? name + ': ' + lines[i + 1] : ''; };
      const verdict = lines.find(l => /^(trustworthy|suspicious|unreliable|not reliable)/i.test(l)) || '?';
      const score = lines[lines.indexOf('MX SCORE') - 1];
      return ['verdict: ' + verdict, at('HARDWARE'), at('SOFTWARE'), 'score: ' + score].filter(Boolean).join(' | ');
    })()`,
  },
  // Decides "human or bot" from automation signals.
  areyouabot: {
    url: 'https://deviceandbrowserinfo.com/are_you_a_bot',
    waitMs: 15000,
    read: `(() => {
      const text = document.body.innerText;
      const lines = text.split('\\n').map(l => l.trim()).filter(l => /you are|human|bot|true|inconsisten/i.test(l) && l.length < 110);
      return [...new Set(lines)].slice(0, 20).join(' | ');
    })()`,
  },
};

const [wsUrl, ...wanted] = process.argv.slice(2);
if (!wsUrl) {
  console.error('usage: probe-sites.mjs <browser websocket URL> [site ...]\nsites: ' + Object.keys(SITES).join(', '));
  process.exit(2);
}
const socket = new WebSocket(wsUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true });
  socket.addEventListener('error', () => reject(new Error(`cannot connect to ${wsUrl}`)), { once: true });
});
let nextId = 1;
const pending = new Map();
socket.addEventListener('message', (event) => {
  const message = JSON.parse(event.data);
  const waiter = pending.get(message.id);
  if (!waiter) return;
  pending.delete(message.id);
  if (message.error) waiter.reject(new Error(message.error.message));
  else waiter.resolve(message.result);
});
function send(method, params = {}, sessionId) {
  const id = nextId++;
  const message = { id, method, params };
  if (sessionId) message.sessionId = sessionId;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify(message));
  });
}

for (const name of wanted.length ? wanted : Object.keys(SITES)) {
  const site = SITES[name];
  if (!site) { console.log(`${name}: unknown site`); continue; }
  const { targetId } = await send('Target.createTarget', { url: site.url });
  try {
    const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
    await send('Target.activateTarget', { targetId }).catch(() => {});
    await delay(site.waitMs);
    const expression = process.env.PROBE_RAW ? 'document.body.innerText.slice(0, 6000)' : site.read;
    const reply = await send('Runtime.evaluate', { expression, returnByValue: true }, sessionId);
    console.log(`${name}: ${reply.result?.value ?? '(no result)'}`);
  } catch (error) {
    console.log(`${name}: could not be read (${error.message})`);
  } finally {
    await send('Target.closeTarget', { targetId }).catch(() => {});
  }
}
socket.close();

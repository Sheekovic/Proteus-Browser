// Opens the Proteus test pages in an already running browser, through its DevTools
// (CDP) browser endpoint, and prints what each page reports. Works with any
// Chromium-based browser, which makes it the tool for comparing behaviour between
// browsers on the same pages.
//
// usage: node probe-browser.mjs <browser websocket URL> <pages base URL> <page> [page...]
//   e.g. node probe-browser.mjs ws://127.0.0.1:9222/devtools/browser/<id> http://127.0.0.1:8792 \
//          noise-probe.html canvas.html
import { setTimeout as delay } from 'node:timers/promises';

const [wsUrl, pagesUrl, ...pages] = process.argv.slice(2);
if (!wsUrl || !pagesUrl || pages.length === 0) {
  console.error('usage: probe-browser.mjs <browser websocket URL> <pages base URL> <page> [page...]');
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

const WAIT_FOR_RESULT = `new Promise((resolve, reject) => {
  const started = Date.now();
  const timer = setInterval(() => {
    const text = document.body ? document.body.innerText : '';
    if (text.startsWith('RESULT')) { clearInterval(timer); resolve(text); }
    else if (Date.now() - started > 20000) { clearInterval(timer); reject(new Error('no RESULT: ' + text.slice(0, 200))); }
  }, 100);
})`;

async function readPage(url) {
  const { targetId } = await send('Target.createTarget', { url });
  try {
    const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
    for (let attempt = 0; attempt < 6; attempt++) {
      try {
        const reply = await send('Runtime.evaluate',
          { expression: WAIT_FOR_RESULT, awaitPromise: true, returnByValue: true }, sessionId);
        if (typeof reply.result?.value === 'string') return reply.result.value;
      } catch {
        // The page was still navigating; ask again.
      }
      await delay(500);
    }
    return 'RESULT (none)';
  } finally {
    await send('Target.closeTarget', { targetId }).catch(() => {});
  }
}

const version = await send('Browser.getVersion');
console.log(`browser: ${version.product}`);
console.log(`userAgent: ${version.userAgent}`);
for (const page of pages) {
  const result = await readPage(`${pagesUrl}/${page}`);
  console.log(`\n== ${page}`);
  for (const part of result.replace(/^RESULT\s+/, '').split(/\s+/)) {
    const at = part.indexOf('=');
    if (at > 0) {
      let value = part.slice(at + 1);
      try { value = decodeURIComponent(value); } catch { /* keep raw */ }
      console.log(`  ${part.slice(0, at)} = ${value}`);
    }
  }
}
socket.close();

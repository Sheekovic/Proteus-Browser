// Serves surface-page.html and saves what each browser that opens it sends back: the
// names of the interfaces and functions it offers to pages. Used to learn what a real
// phone's browser has, so that a phone profile can be given exactly that (surface.ts).
//
// A browser shows much of what it has only to a page opened securely, so the page is
// served over HTTPS with a certificate of your own (the phone will warn once; choose
// to visit anyway), on every network address of this computer. A second, plain port on
// 127.0.0.1 is for browsers on this computer, which treat it as secure.
//
// usage: node read-surface.mjs <certificate.pem> <key.pem> <output folder> [minutes]
//   Open  https://<this computer's address>:8443/  on the phone.
//   Each reading is written to <output folder>/surface-<browser>-<time>.json.
//   The server stops by itself after [minutes] (default 30).

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer as createPlain } from 'node:http';
import { createServer as createSecure } from 'node:https';
import { connect, createServer as createFront } from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const [certificate, key, folder, minutes = '30'] = process.argv.slice(2);
if (!certificate || !key || !folder) {
  console.error('usage: node read-surface.mjs <certificate.pem> <key.pem> <output folder> [minutes]');
  process.exit(2);
}
mkdirSync(folder, { recursive: true });
const page = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'surface-page.html'));
const MAX_BYTES = 8 * 1024 * 1024;

function browserOf(userAgent) {
  if (/iPhone|iPad/.test(userAgent)) return /CriOS/.test(userAgent) ? 'chrome-ios' : /FxiOS/.test(userAgent) ? 'firefox-ios' : 'safari-ios';
  if (/Android/.test(userAgent)) return /Firefox/.test(userAgent) ? 'firefox-android' : 'chrome-android';
  if (/Firefox/.test(userAgent)) return 'firefox';
  if (/Chrome/.test(userAgent)) return 'chrome';
  return /Safari/.test(userAgent) ? 'safari' : 'browser';
}

function handle(request, response) {
  if (request.method === 'GET' && (request.url === '/' || request.url === '/index.html')) {
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    response.end(page);
    return;
  }
  if (request.method === 'POST' && request.url === '/save') {
    const chunks = [];
    let size = 0;
    request.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BYTES) request.destroy(); else chunks.push(chunk);
    });
    request.on('end', () => {
      try {
        const reading = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (typeof reading.userAgent !== 'string' || !Array.isArray(reading.page?.globals)) throw new Error('not a reading');
        const name = `surface-${browserOf(reading.userAgent)}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
        writeFileSync(join(folder, name), JSON.stringify(reading));
        console.log(`SAVED ${name}: ${reading.page.globals.length} names, ${Object.keys(reading.page.interfaces ?? {}).length} interfaces, ` +
            `secure=${reading.secure}, worker=${reading.worker ? reading.worker.globals.length : 'none'} | ${reading.userAgent}`);
        response.writeHead(204).end();
      } catch (error) {
        console.log('refused a reading:', error.message);
        response.writeHead(400).end();
      }
    });
    return;
  }
  response.writeHead(404).end();
}

const secure = createSecure({ cert: readFileSync(certificate), key: readFileSync(key) }, handle);
secure.on('tlsClientError', (error) => console.log('TLS:', error.code ?? error.message));
await new Promise((resolve) => secure.listen(0, '127.0.0.1', resolve));
// The port the phone opens takes both: a secure connection goes to the server above,
// and a plain one (an address typed without https://) is sent on to the secure one,
// where the page can see everything.
const front = createFront((socket) => {
  socket.on('error', () => {});
  socket.once('data', (first) => {
    if (first[0] === 0x16) {   // the start of a TLS hello
      const inner = connect(secure.address().port, '127.0.0.1', () => {
        inner.write(first);
        socket.pipe(inner).pipe(socket);
      });
      inner.on('error', () => socket.destroy());
      return;
    }
    const host = /\r\nhost:\s*([^\r\n]+)/i.exec(first.toString('latin1'))?.[1]?.trim() ?? '';
    console.log('a plain request: sent on to https');
    socket.end(/^[A-Za-z0-9.\-\[\]:]+$/.test(host)
      ? `HTTP/1.1 302 Found\r\nLocation: https://${host}/\r\nContent-Length: 0\r\nConnection: close\r\n\r\n`
      : 'HTTP/1.1 400 Bad Request\r\nContent-Length: 0\r\nConnection: close\r\n\r\n');
  });
});
front.listen(8443, '0.0.0.0', () => console.log('listening: every address, port 8443'));
const plain = createPlain(handle);
plain.listen(8444, '127.0.0.1', () => console.log('listening: http://127.0.0.1:8444/ for browsers on this computer'));
setTimeout(() => { console.log('time is up'); process.exit(0); }, Number(minutes) * 60_000);

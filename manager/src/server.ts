// The local HTTP API and the web UI it serves.
//
//   GET    /api/health
//   GET    /api/update                   is there a newer release? (asks GitHub; only when called)
//   GET    /api/settings                 PUT /api/settings
//   GET    /api/profiles                 POST /api/profiles
//   GET    /api/profiles/:id             PATCH /api/profiles/:id      DELETE /api/profiles/:id
//   POST   /api/profiles/:id/regenerate  new identity, same name/proxy/browser data
//   POST   /api/profiles/:id/duplicate   a new profile with the same settings and an identity of its own
//   POST   /api/profiles/bulk            many at once (bulk.ts): {count, name, common, proxies, ...}
//   GET    /api/profiles/:id/status
//   POST   /api/profiles/:id/start       POST /api/profiles/:id/stop
//   GET    /api/profiles/:id/transport   the TLS and HTTP/2 shape its browser makes, beside what it claims to be
//   GET    /api/presets                  ready-made setups; POST /api/profiles {preset: "<id>"} uses one
//
// A profile's state has one shape in every reply: `state` ("running" or "stopped") and
// `status` (the details: pid, debuggerUrl, proxyExit, ...). A profile carries both
// beside its own fields; the status, start and stop replies carry both too, and keep
// the details at the top level as well, where they have always been. Where a proxy
// comes out (`proxyExit`, or `lastProxyExit` on a stopped profile) is at the top level
// of every one of them, a profile in the list included.
//   GET    /api/fingerprints             POST /api/fingerprints       a fingerprint read from a real device
//   GET    /api/fingerprints/:id         DELETE /api/fingerprints/:id
//   GET    /collect                      the page that reads a device's fingerprint
//   GET    /                             the web UI
//
// Driving a running profile's browser (browserControl.ts):
//   GET    /api/profiles/:id/tabs                      POST /api/profiles/:id/tabs  {url}
//   DELETE /api/profiles/:id/tabs/:tab
//   POST   /api/profiles/:id/tabs/:tab/navigate  {url}
//   POST   /api/profiles/:id/tabs/:tab/evaluate  {expression}
//   GET    /api/profiles/:id/tabs/:tab/text
//   GET    /api/profiles/:id/tabs/:tab/screenshot      a PNG; ?full=1 for the whole page
//   GET    /api/profiles/:id/cookies                   PUT /api/profiles/:id/cookies  [cookie, ...]
//
//   POST   /api/proxy/check              {proxy} or {profileId}: where that proxy comes out, or why it fails
//   GET    /api                          this list, as JSON
//   POST   /mcp                          the same abilities as Model Context Protocol tools (mcp.ts)

import { readFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { join } from 'node:path';

import * as browser from './browserControl.ts';
import { type BulkRequest, createProfiles } from './bulk.ts';
import { describeCollected } from './collected.ts';
import { generateIdentity } from './fingerprint.ts';
import { entryStateOf, LaunchError, type Launcher, stateOf } from './launcher.ts';
import { listPresets } from './presets.ts';
import { handleMcp } from './mcp.ts';
import { type Profile, validateProxy, ValidationError } from './profile.ts';
import { toProfileInput } from './profileInput.ts';
import { checkProxy } from './proxyExit.ts';
import { NotFoundError, type Store, type StoredFingerprint } from './store.ts';
import { bundleVersion, checkForUpdate } from './update.ts';

class HttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** Large enough for a profile's cookies or a long script. */
const MAX_BODY_BYTES = 4 * 1024 * 1024;

/** What the API offers, for GET /api. */
const ROUTES = [
  'GET /api/health', 'GET /api/update', 'GET /api/settings', 'PUT /api/settings', 'POST /api/proxy/check', 'GET /api/presets',
  'GET /api/profiles', 'POST /api/profiles', 'GET /api/profiles/:id', 'PATCH /api/profiles/:id', 'DELETE /api/profiles/:id',
  'GET /api/profiles/:id/status', 'POST /api/profiles/:id/start', 'POST /api/profiles/:id/stop', 'GET /api/profiles/:id/transport', 'POST /api/profiles/:id/regenerate', 'POST /api/profiles/:id/duplicate', 'POST /api/profiles/bulk',
  'GET /api/profiles/:id/tabs', 'POST /api/profiles/:id/tabs', 'DELETE /api/profiles/:id/tabs/:tab',
  'POST /api/profiles/:id/tabs/:tab/navigate', 'POST /api/profiles/:id/tabs/:tab/evaluate',
  'GET /api/profiles/:id/tabs/:tab/text', 'GET /api/profiles/:id/tabs/:tab/screenshot',
  'GET /api/profiles/:id/cookies', 'PUT /api/profiles/:id/cookies',
  'GET /api/fingerprints', 'POST /api/fingerprints', 'GET /api/fingerprints/:id', 'DELETE /api/fingerprints/:id',
  'POST /mcp',
];

/** A stored fingerprint as lists show it: what device it is, not every value read. */
function fingerprintSummary(stored: StoredFingerprint) {
  return {
    id: stored.id,
    addedAt: stored.addedAt,
    label: stored.collected.label,
    ...describeCollected(stored.collected),
    fonts: stored.collected.fonts.length,
    voices: stored.collected.voices.length,
  };
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  // Requiring a JSON content type means a web page cannot send this request with a
  // plain HTML form, and any cross-origin script attempt needs a CORS preflight
  // that this server never approves.
  const contentType = (request.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
  if (contentType !== 'application/json') {
    throw new HttpError(415, 'Content-Type must be application/json');
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) throw new HttpError(413, 'request body too large');
    chunks.push(chunk as Buffer);
  }
  if (size === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, 'request body is not valid JSON');
  }
}

function sendJson(response: ServerResponse, status: number, value: unknown): void {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  response.end(body);
}

export interface ServerOptions {
  store: Store;
  launcher: Launcher;
  /** Directory holding index.html for the web UI. */
  uiDir: string;
}

export function createApiServer({ store, launcher, uiDir }: ServerOptions): Server {
  /**
   * The API has no login, so it must only ever answer the local user. Binding to
   * 127.0.0.1 keeps other machines out; these checks keep other web pages out:
   *  - Host must be a loopback name (defeats DNS rebinding), and
   *  - a request carrying an Origin must come from this server's own pages.
   */
  function checkLocalRequest(request: IncomingMessage): void {
    const host = request.headers.host ?? '';
    if (!/^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/i.test(host)) {
      throw new HttpError(403, 'requests must be addressed to localhost');
    }
    const origin = request.headers.origin;
    if (origin !== undefined && origin !== `http://${host}`) {
      throw new HttpError(403, 'cross-origin requests are not allowed');
    }
  }

  /** A profile as every reply shows it: its fields, `state` and `status`. */
  async function described(profile: Profile) {
    return { ...profile, ...entryStateOf(await launcher.statusOf(profile)) };
  }

  async function withStatus(id: string) {
    return described(await store.getProfile(id));
  }

  /** The reply of the status, start and stop routes: the details, and the one shape around them. */
  async function statusReply(id: string) {
    const status = await launcher.statusOf(await store.getProfile(id));
    return { ...status, ...stateOf(status) };
  }

  async function route(request: IncomingMessage, response: ServerResponse): Promise<void> {
    checkLocalRequest(request);
    const method = request.method ?? 'GET';
    const path = new URL(request.url ?? '/', 'http://localhost').pathname;

    if (method === 'GET' && (path === '/' || path === '/index.html')) {
      const html = await readFile(join(uiDir, 'index.html'));
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      response.end(html);
      return;
    }
    if (method === 'GET' && path === '/api') {
      return sendJson(response, 200, { name: 'proteus-manager', routes: ROUTES, mcp: '/mcp' });
    }
    if (path === '/mcp') {
      if (method !== 'POST') throw new HttpError(405, 'the MCP endpoint takes POST requests');
      const reply = await handleMcp(await readJsonBody(request), { store, launcher });
      if (reply === undefined) {
        response.writeHead(202).end();
        return;
      }
      return sendJson(response, 200, reply);
    }
    if (method === 'GET' && path === '/api/health') {
      return sendJson(response, 200, { ok: true, name: 'proteus-manager' });
    }
    // Asked for by the user, never by the manager itself: it contacts GitHub.
    if (method === 'GET' && path === '/api/update') {
      return sendJson(response, 200, await checkForUpdate(bundleVersion(join(uiDir, '..'))));
    }
    if (path === '/api/profiles/bulk' && method === 'POST') {
      const made = await createProfiles(store, (await readJsonBody(request)) as BulkRequest);
      return sendJson(response, 201, await Promise.all(made.map(described)));
    }
    if (method === 'GET' && path === '/api/presets') return sendJson(response, 200, listPresets());
    if (path === '/api/proxy/check' && method === 'POST') {
      // Either a proxy to try, or the id of a profile whose proxy to try.
      const body = (await readJsonBody(request)) as Record<string, unknown> | null;
      const proxy = typeof body?.profileId === 'string' ? (await store.getProfile(body.profileId)).proxy : body?.proxy;
      if (proxy === null || proxy === undefined) throw new ValidationError('there is no proxy to check');
      validateProxy(proxy);
      try {
        const check = await checkProxy(proxy, (await store.getSettings()).exitLookupUrl);
        // Remembered, so the profiles using this proxy can show where it comes out.
        const { ms: _ms, ...exit } = check;
        await launcher.noteExit(proxy, exit);
        return sendJson(response, 200, check);
      } catch (error) {
        // The proxy's own failure is a result of the check, not a fault of the request.
        return sendJson(response, 200, { error: (error as Error).message });
      }
    }
    if (path === '/api/settings') {
      if (method === 'GET') return sendJson(response, 200, await store.getSettings());
      if (method === 'PUT') {
        const body = await readJsonBody(request);
        if (typeof body !== 'object' || body === null) throw new ValidationError('settings must be an object');
        return sendJson(response, 200, await store.updateSettings(body));
      }
    }
    if (path === '/api/profiles') {
      if (method === 'GET') {
        const profiles = await store.listProfiles();
        return sendJson(response, 200, await Promise.all(profiles.map(described)));
      }
      if (method === 'POST') {
        const body = await readJsonBody(request);
        // "fingerprintId" names a stored device fingerprint to take the identity from.
        // "preset" names a ready-made setup (GET /api/presets) to take it from instead.
        const { fingerprintId, preset } = (body ?? {}) as Record<string, unknown>;
        if (fingerprintId !== undefined && typeof fingerprintId !== 'string') {
          throw new ValidationError('fingerprintId must be a string');
        }
        if (preset !== undefined && typeof preset !== 'string') throw new ValidationError('preset must be a string');
        return sendJson(response, 201, await described(await store.createProfile(toProfileInput(body), fingerprintId, preset)));
      }
    }

    if (method === 'GET' && path === '/collect') {
      const html = await readFile(join(uiDir, 'collect.html'));
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      response.end(html);
      return;
    }
    if (path === '/api/fingerprints') {
      if (method === 'GET') {
        return sendJson(response, 200, (await store.listFingerprints()).map(fingerprintSummary));
      }
      if (method === 'POST') {
        return sendJson(response, 201, fingerprintSummary(await store.addFingerprint(await readJsonBody(request))));
      }
    }
    const fingerprint = /^\/api\/fingerprints\/([^/]+)$/.exec(path);
    if (fingerprint) {
      if (method === 'GET') return sendJson(response, 200, await store.getFingerprint(fingerprint[1]));
      if (method === 'DELETE') {
        await store.deleteFingerprint(fingerprint[1]);
        response.writeHead(204).end();
        return;
      }
      throw new HttpError(405, `${method} is not supported on ${path}`);
    }

    // A running profile's browser.
    const control = /^\/api\/profiles\/([^/]+)\/(tabs|cookies)(?:\/([^/]+)(?:\/(navigate|evaluate|text|screenshot))?)?$/.exec(path);
    if (control) {
      const [, id, what, tab, action] = control;
      await store.getProfile(id);
      const status = launcher.status(id);
      if (status.state !== 'running' || !status.debuggerUrl) throw new HttpError(409, 'start the profile first');
      const address = status.debuggerUrl;
      const field = async (name: string) => ((await readJsonBody(request)) as Record<string, unknown> | null)?.[name];
      if (what === 'cookies' && tab === undefined) {
        if (method === 'GET') return sendJson(response, 200, await browser.getCookies(address));
        if (method === 'PUT') {
          // A list of cookies, or {text} holding an export file as it is.
          const body = await readJsonBody(request);
          const cookies = Array.isArray(body) ? body : browser.cookiesFromText((body as { text?: unknown } | null)?.text);
          return sendJson(response, 200, { added: await browser.setCookies(address, cookies) });
        }
      } else if (what === 'tabs' && tab === undefined) {
        if (method === 'GET') return sendJson(response, 200, await browser.listTabs(address));
        if (method === 'POST') return sendJson(response, 201, await browser.openTab(address, (await field('url')) ?? 'about:blank'));
      } else if (what === 'tabs' && tab !== undefined && action === undefined) {
        if (method === 'DELETE') {
          await browser.closeTab(address, tab);
          response.writeHead(204).end();
          return;
        }
      } else if (what === 'tabs' && tab !== undefined) {
        if (action === 'navigate' && method === 'POST') return sendJson(response, 200, await browser.navigate(address, tab, await field('url')));
        if (action === 'evaluate' && method === 'POST') {
          return sendJson(response, 200, { value: (await browser.evaluate(address, tab, await field('expression'))) ?? null });
        }
        if (action === 'text' && method === 'GET') return sendJson(response, 200, await browser.pageText(address, tab));
        if (action === 'screenshot' && method === 'GET') {
          const full = new URL(request.url ?? '/', 'http://localhost').searchParams.get('full') === '1';
          const png = await browser.screenshot(address, tab, full);
          response.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': png.length, 'Cache-Control': 'no-store' });
          response.end(png);
          return;
        }
      }
      throw new HttpError(405, `${method} is not supported on ${path}`);
    }

    const match = /^\/api\/profiles\/([^/]+)(?:\/(status|start|stop|regenerate|duplicate|transport))?$/.exec(path);
    if (match) {
      const [, id, action] = match;
      if (!action) {
        if (method === 'GET') return sendJson(response, 200, await withStatus(id));
        if (method === 'PATCH') {
          await store.updateProfile(id, toProfileInput(await readJsonBody(request)));
          return sendJson(response, 200, await withStatus(id));
        }
        if (method === 'DELETE') {
          if (launcher.isRunning(id)) throw new HttpError(409, 'stop the profile before deleting it');
          await store.deleteProfile(id);
          response.writeHead(204).end();
          return;
        }
      } else if (action === 'status' && method === 'GET') {
        return sendJson(response, 200, await statusReply(id));
      } else if (action === 'transport' && method === 'GET') {
        return sendJson(response, 200, await launcher.transport(await store.getProfile(id)));
      } else if (action === 'start' && method === 'POST') {
        await launcher.start(await store.getProfile(id));
        return sendJson(response, 200, await statusReply(id));
      } else if (action === 'stop' && method === 'POST') {
        await store.getProfile(id);
        await launcher.stop(id);
        return sendJson(response, 200, await statusReply(id));
      } else if (action === 'duplicate' && method === 'POST') {
        return sendJson(response, 201, await described(await store.duplicateProfile(id)));
      } else if (action === 'regenerate' && method === 'POST') {
        if (launcher.isRunning(id)) throw new HttpError(409, 'stop the profile before changing its identity');
        const current = await store.getProfile(id);
        const settings = await store.getSettings();
        await store.updateProfile(id, generateIdentity(current.os, settings.kernelVersion));
        return sendJson(response, 200, await withStatus(id));
      }
      throw new HttpError(405, `${method} is not supported on ${path}`);
    }

    throw new HttpError(404, `nothing at ${path}`);
  }

  return createServer((request, response) => {
    route(request, response).catch((error: unknown) => {
      let status = 500;
      if (error instanceof HttpError) status = error.status;
      else if (error instanceof ValidationError) status = 400;
      else if (error instanceof NotFoundError) status = 404;
      else if (error instanceof LaunchError) status = 502;
      else if (error instanceof browser.BrowserError) status = 422;
      const message = error instanceof Error ? error.message : String(error);
      if (status === 500) console.error(error);
      if (response.headersSent) response.end();
      else sendJson(response, status, { error: message });
    });
  });
}

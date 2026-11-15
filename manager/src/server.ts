// The local HTTP API and the web UI it serves.
//
//   GET    /api/health
//   GET    /api/settings                 PUT /api/settings
//   GET    /api/profiles                 POST /api/profiles
//   GET    /api/profiles/:id             PATCH /api/profiles/:id      DELETE /api/profiles/:id
//   POST   /api/profiles/:id/regenerate  new identity, same name/proxy/browser data
//   GET    /api/profiles/:id/status
//   POST   /api/profiles/:id/start       POST /api/profiles/:id/stop
//   GET    /                             the web UI

import { readFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { join } from 'node:path';

import { generateIdentity } from './fingerprint.ts';
import { LaunchError, type Launcher } from './launcher.ts';
import { type ProfileInput, ValidationError } from './profile.ts';
import { NotFoundError, type Store } from './store.ts';

class HttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const MAX_BODY_BYTES = 256 * 1024;

const PROFILE_INPUT_KEYS = [
  'name', 'notes', 'seed', 'os', 'userAgent', 'platform', 'uaData', 'hardwareConcurrency',
  'deviceMemory', 'screen', 'languages', 'timezone', 'webgl', 'webgpu', 'noise', 'voices', 'fonts', 'webrtc', 'webrtcPublicIp', 'proxy', 'startUrl',
] as const;

/** Keeps only the fields a client may set, so unknown keys never reach a stored profile. */
function toProfileInput(body: unknown): ProfileInput {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new ValidationError('the request body must be a JSON object');
  }
  const input: Record<string, unknown> = {};
  for (const key of PROFILE_INPUT_KEYS) {
    if (key in body) input[key] = (body as Record<string, unknown>)[key];
  }
  return input as ProfileInput;
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

  async function withStatus(id: string) {
    return { ...(await store.getProfile(id)), status: launcher.status(id) };
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
    if (method === 'GET' && path === '/api/health') {
      return sendJson(response, 200, { ok: true, name: 'proteus-manager' });
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
        return sendJson(response, 200, profiles.map((p) => ({ ...p, status: launcher.status(p.id) })));
      }
      if (method === 'POST') {
        const profile = await store.createProfile(toProfileInput(await readJsonBody(request)));
        return sendJson(response, 201, { ...profile, status: launcher.status(profile.id) });
      }
    }

    const match = /^\/api\/profiles\/([^/]+)(?:\/(status|start|stop|regenerate))?$/.exec(path);
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
        await store.getProfile(id);
        return sendJson(response, 200, launcher.status(id));
      } else if (action === 'start' && method === 'POST') {
        return sendJson(response, 200, await launcher.start(await store.getProfile(id)));
      } else if (action === 'stop' && method === 'POST') {
        await store.getProfile(id);
        return sendJson(response, 200, await launcher.stop(id));
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
      const message = error instanceof Error ? error.message : String(error);
      if (status === 500) console.error(error);
      if (response.headersSent) response.end();
      else sendJson(response, status, { error: message });
    });
  });
}

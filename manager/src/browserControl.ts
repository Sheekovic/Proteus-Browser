// Driving a running profile's browser: its tabs, what they show, and its cookies.
//
// This speaks the DevTools protocol to the kernel, at the address the launcher got
// for the profile. It is a convenience for callers of the API and of the MCP
// endpoint; tools that speak that protocol themselves (Puppeteer, Playwright,
// Selenium) can connect to the same address directly.

export class BrowserError extends Error {}

export interface Tab {
  id: string;
  title: string;
  url: string;
}

export interface Cookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  /** Seconds since 1970; absent or -1 for a cookie that ends with the session. */
  expires?: number;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: 'Strict' | 'Lax' | 'None';
}

const COMMAND_TIMEOUT_MS = 30_000;
const TAB_ID = /^[0-9A-Fa-f]{16,64}$/;

interface Target {
  id: string;
  type: string;
  title: string;
  url: string;
  webSocketDebuggerUrl?: string;
}

async function targets(debuggerUrl: string): Promise<Target[]> {
  try {
    const response = await fetch(`${debuggerUrl}/json/list`, { signal: AbortSignal.timeout(5000) });
    return (await response.json()) as Target[];
  } catch (error) {
    throw new BrowserError(`The profile's browser does not answer: ${(error as Error).message}`);
  }
}

/** The tabs of the browser at `debuggerUrl` (pages only: not its own toolbar or extensions). */
export async function listTabs(debuggerUrl: string): Promise<Tab[]> {
  return (await targets(debuggerUrl))
      .filter((target) => target.type === 'page')
      .map(({ id, title, url }) => ({ id, title, url }));
}

async function findTab(debuggerUrl: string, tabId: string): Promise<Target> {
  if (!TAB_ID.test(tabId)) throw new BrowserError(`"${tabId}" is not a tab id`);
  const tab = (await targets(debuggerUrl)).find((target) => target.type === 'page' && target.id === tabId);
  if (!tab || !tab.webSocketDebuggerUrl) throw new BrowserError(`The profile has no tab with id ${tabId}`);
  return tab;
}

/** One DevTools connection to a tab; closed by the caller. */
class Session {
  private readonly socket: WebSocket;
  private nextId = 1;
  private readonly waiting = new Map<number, { resolve: (value: Record<string, unknown>) => void; reject: (error: Error) => void }>();
  private readonly listeners = new Map<string, () => void>();

  private constructor(socket: WebSocket) {
    this.socket = socket;
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data)) as { id?: number; method?: string; result?: Record<string, unknown>; error?: { message: string } };
      if (message.id !== undefined) {
        const entry = this.waiting.get(message.id);
        if (!entry) return;
        this.waiting.delete(message.id);
        if (message.error) entry.reject(new BrowserError(message.error.message));
        else entry.resolve(message.result ?? {});
      } else if (message.method) {
        this.listeners.get(message.method)?.();
      }
    });
    socket.addEventListener('close', () => {
      for (const entry of this.waiting.values()) entry.reject(new BrowserError('The tab was closed.'));
      this.waiting.clear();
    });
  }

  static async open(tab: Target): Promise<Session> {
    const socket = new WebSocket(tab.webSocketDebuggerUrl as string);
    await new Promise<void>((resolve, reject) => {
      socket.addEventListener('open', () => resolve(), { once: true });
      socket.addEventListener('error', () => reject(new BrowserError('Could not connect to the tab.')), { once: true });
    });
    return new Session(socket);
  }

  send(method: string, params: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiting.delete(id);
        reject(new BrowserError(`The browser did not answer ${method} in time.`));
      }, COMMAND_TIMEOUT_MS);
      this.waiting.set(id, {
        resolve: (value) => { clearTimeout(timer); resolve(value); },
        reject: (error) => { clearTimeout(timer); reject(error); },
      });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  /** Resolves when the browser reports `event`, or after `ms`. */
  once(event: string, ms: number): Promise<boolean> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => { this.listeners.delete(event); resolve(false); }, ms);
      this.listeners.set(event, () => { clearTimeout(timer); this.listeners.delete(event); resolve(true); });
    });
  }

  close(): void {
    this.socket.close();
  }
}

async function withTab<T>(debuggerUrl: string, tabId: string, work: (session: Session) => Promise<T>): Promise<T> {
  const session = await Session.open(await findTab(debuggerUrl, tabId));
  try {
    return await work(session);
  } finally {
    session.close();
  }
}

function checkUrl(url: unknown): string {
  if (typeof url !== 'string' || url.length > 4000 || !/^(https?:\/\/|about:blank$)/i.test(url)) {
    throw new BrowserError('url must start with http:// or https:// (or be about:blank)');
  }
  return url;
}

/** Opens a new tab on `url` and returns it. */
export async function openTab(debuggerUrl: string, url: unknown = 'about:blank'): Promise<Tab> {
  const address = checkUrl(url);
  try {
    const response = await fetch(`${debuggerUrl}/json/new?${encodeURIComponent(address)}`,
                                 { method: 'PUT', signal: AbortSignal.timeout(10_000) });
    const { id, title, url: opened } = (await response.json()) as Target;
    return { id, title, url: opened };
  } catch (error) {
    throw new BrowserError(`Could not open a tab: ${(error as Error).message}`);
  }
}

export async function closeTab(debuggerUrl: string, tabId: string): Promise<void> {
  await findTab(debuggerUrl, tabId);
  await fetch(`${debuggerUrl}/json/close/${tabId}`, { signal: AbortSignal.timeout(10_000) });
}

/** Sends the tab to `url` and waits (up to 30 seconds) for the page to finish loading. */
export async function navigate(debuggerUrl: string, tabId: string, url: unknown): Promise<Tab & { loaded: boolean }> {
  const address = checkUrl(url);
  return withTab(debuggerUrl, tabId, async (session) => {
    await session.send('Page.enable');
    const loaded = session.once('Page.loadEventFired', COMMAND_TIMEOUT_MS);
    const result = await session.send('Page.navigate', { url: address });
    if (typeof result.errorText === 'string' && result.errorText !== '') {
      throw new BrowserError(`The page did not load: ${result.errorText}`);
    }
    const finished = await loaded;
    const now = await evaluateIn(session, 'JSON.stringify({ title: document.title, url: location.href })');
    return { id: tabId, ...(JSON.parse(String(now)) as { title: string; url: string }), loaded: finished };
  });
}

async function evaluateIn(session: Session, expression: string): Promise<unknown> {
  const reply = await session.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true });
  const problem = reply.exceptionDetails as { text?: string; exception?: { description?: string } } | undefined;
  if (problem) throw new BrowserError(problem.exception?.description ?? problem.text ?? 'The script threw.');
  return (reply.result as { value?: unknown } | undefined)?.value;
}

/**
 * Runs `expression` in the tab's page and returns its value (awaited, if it is a
 * promise). The value must be something JSON can carry.
 */
export async function evaluate(debuggerUrl: string, tabId: string, expression: unknown): Promise<unknown> {
  if (typeof expression !== 'string' || expression.length > 200_000) {
    throw new BrowserError('expression must be JavaScript source text');
  }
  return withTab(debuggerUrl, tabId, (session) => evaluateIn(session, expression));
}

/** The visible text of the tab's page, with its title and address. */
export async function pageText(debuggerUrl: string, tabId: string, maxChars = 50_000): Promise<Tab & { text: string }> {
  const value = await evaluate(debuggerUrl, tabId,
      `JSON.stringify({ title: document.title, url: location.href, text: (document.body ? document.body.innerText : '').slice(0, ${Math.floor(maxChars)}) })`);
  return { id: tabId, ...(JSON.parse(String(value)) as { title: string; url: string; text: string }) };
}

/** A PNG picture of what the tab shows (the visible part, or the whole page). */
export async function screenshot(debuggerUrl: string, tabId: string, fullPage = false): Promise<Buffer> {
  return withTab(debuggerUrl, tabId, async (session) => {
    const reply = await session.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: fullPage });
    if (typeof reply.data !== 'string') throw new BrowserError('The browser returned no picture.');
    return Buffer.from(reply.data, 'base64');
  });
}

/**
 * Runs `expression` in a JavaScript world of its own inside the profile's first tab
 * and returns its value: the page in that tab cannot see the script or alter what it
 * reads. For asking the browser about itself (hostLists.ts), not for driving pages.
 */
export async function evaluateApart(debuggerUrl: string, expression: string): Promise<unknown> {
  return withAnyTab(debuggerUrl, async (session) => {
    const tree = await session.send('Page.getFrameTree');
    const frameId = (tree.frameTree as { frame?: { id?: string } } | undefined)?.frame?.id;
    if (typeof frameId !== 'string') throw new BrowserError('The tab has no page to ask.');
    const world = await session.send('Page.createIsolatedWorld', { frameId, worldName: 'proteus' });
    const reply = await session.send('Runtime.evaluate', {
      expression, contextId: world.executionContextId, awaitPromise: true, returnByValue: true,
    });
    if (reply.exceptionDetails) throw new BrowserError('The browser could not be asked.');
    return (reply.result as { value?: unknown } | undefined)?.value;
  });
}

/** A tab to ask browser-wide questions through; opens one if the profile has none. */
async function anyTab(debuggerUrl: string): Promise<{ tab: Target; opened: boolean }> {
  const existing = (await targets(debuggerUrl)).find((target) => target.type === 'page' && target.webSocketDebuggerUrl);
  if (existing) return { tab: existing, opened: false };
  const created = await openTab(debuggerUrl);
  return { tab: await findTab(debuggerUrl, created.id), opened: true };
}

async function withAnyTab<T>(debuggerUrl: string, work: (session: Session) => Promise<T>): Promise<T> {
  const { tab, opened } = await anyTab(debuggerUrl);
  const session = await Session.open(tab);
  try {
    return await work(session);
  } finally {
    session.close();
    if (opened) await closeTab(debuggerUrl, tab.id).catch(() => {});
  }
}

/** Every cookie the profile holds, for all sites. */
export async function getCookies(debuggerUrl: string): Promise<Cookie[]> {
  return withAnyTab(debuggerUrl, async (session) => {
    const reply = await session.send('Network.getAllCookies');
    return (reply.cookies as (Cookie & Record<string, unknown>)[]).map((cookie) => ({
      name: cookie.name, value: cookie.value, domain: cookie.domain, path: cookie.path,
      ...(typeof cookie.expires === 'number' && cookie.expires > 0 ? { expires: cookie.expires } : {}),
      httpOnly: cookie.httpOnly === true, secure: cookie.secure === true,
      ...(cookie.sameSite ? { sameSite: cookie.sameSite } : {}),
    }));
  });
}

const SAME_SITE: Record<string, Cookie['sameSite']> = { strict: 'Strict', lax: 'Lax', none: 'None', no_restriction: 'None' };

/**
 * Cookies from the text of an export file, in either of the two usual forms: JSON (a
 * list, as browser extensions write it, or an object holding one under "cookies"),
 * or the tab-separated "cookies.txt" form.
 */
export function cookiesFromText(text: unknown): Cookie[] {
  if (typeof text !== 'string') throw new BrowserError('the cookie file must be text');
  const trimmed = text.trim();
  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    let data: unknown;
    try {
      data = JSON.parse(trimmed);
    } catch {
      throw new BrowserError('the cookie file is not valid JSON');
    }
    return cleanCookies(Array.isArray(data) ? data : (data as { cookies?: unknown }).cookies);
  }
  if (trimmed === '') throw new BrowserError('the cookie file is empty');
  const cookies: unknown[] = [];
  for (let line of trimmed.split(/\r?\n/)) {
    let httpOnly = false;
    if (line.startsWith('#HttpOnly_')) {
      httpOnly = true;
      line = line.slice('#HttpOnly_'.length);
    } else if (line.startsWith('#') || line.trim() === '') {
      continue;
    }
    const fields = line.split('\t');
    if (fields.length < 7) throw new BrowserError('this is neither a JSON cookie list nor a cookies.txt file');
    const [domain, , path, secure, expires, name, ...value] = fields;
    cookies.push({ domain, path, secure: secure.toUpperCase() === 'TRUE', expires: Number(expires), name, value: value.join('\t'), httpOnly });
  }
  return cleanCookies(cookies);
}

/** Checks cookies from a caller and returns them in the form the browser takes. */
export function cleanCookies(value: unknown): Cookie[] {
  if (!Array.isArray(value) || value.length > 5000) throw new BrowserError('cookies must be a list');
  return value.map((raw, index) => {
    const cookie = raw as Record<string, unknown>;
    const text = (key: string, max: number, needed = true): string | undefined => {
      const field = cookie?.[key];
      if (field === undefined && !needed) return undefined;
      if (typeof field !== 'string' || field.length > max) throw new BrowserError(`cookie ${index}: ${key} must be text`);
      return field;
    };
    const cleaned: Cookie = {
      name: text('name', 4096) as string, value: text('value', 4096) as string,
      domain: text('domain', 255) as string, path: text('path', 2048, false) ?? '/',
    };
    if (cleaned.name === '' || cleaned.domain === '') throw new BrowserError(`cookie ${index}: name and domain must not be empty`);
    // Browser extensions that export cookies call the expiry "expirationDate" and
    // spell sameSite their own way.
    const expires = [cookie.expires, cookie.expirationDate].find((value) => typeof value === 'number' && Number.isFinite(value) && value > 0);
    if (typeof expires === 'number') cleaned.expires = expires;
    if (cookie.httpOnly === true) cleaned.httpOnly = true;
    if (cookie.secure === true) cleaned.secure = true;
    const sameSite = SAME_SITE[String(cookie.sameSite).toLowerCase()];
    if (sameSite) cleaned.sameSite = sameSite;
    return cleaned;
  });
}

/** Adds `cookies` to the profile (replacing ones of the same name, domain and path). */
export async function setCookies(debuggerUrl: string, cookies: unknown): Promise<number> {
  const cleaned = cleanCookies(cookies);
  if (cleaned.length === 0) return 0;
  await withAnyTab(debuggerUrl, (session) => session.send('Network.setCookies', { cookies: cleaned }));
  return cleaned.length;
}

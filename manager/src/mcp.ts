// The Model Context Protocol endpoint: everything the manager can do, as tools an AI
// assistant can call. Served by the manager itself at POST /mcp (JSON-RPC 2.0, one
// JSON reply per request), so it shares the running profiles with the UI and the API.
// For assistants that only start a program and talk to it over standard input and
// output, src/mcp-stdio.ts forwards to this endpoint.

import * as browser from './browserControl.ts';
import { type BulkRequest, createProfiles } from './bulk.ts';
import { describeCollected } from './collected.ts';
import { generateIdentity } from './fingerprint.ts';
import { entryStateOf, type Launcher, stateOf } from './launcher.ts';
import { listPresets } from './presets.ts';
import { type Profile, validateProxy } from './profile.ts';
import { toProfileInput } from './profileInput.ts';
import { checkProxy } from './proxyExit.ts';
import type { Store } from './store.ts';

export interface McpContext {
  store: Store;
  launcher: Launcher;
}

type Json = Record<string, unknown>;
type Content = { type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string };

interface Tool {
  name: string;
  description: string;
  inputSchema: Json;
  run: (args: Json, context: McpContext) => Promise<unknown>;
}

const PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];
const SERVER_INFO = { name: 'proteus', version: '0.1.0' };

/** A picture to hand back as an image rather than as text. */
class Picture {
  readonly png: Buffer;
  constructor(png: Buffer) { this.png = png; }
}

const text = (description: string) => ({ type: 'string', description });
const object = (properties: Json, required: string[] = []) =>
  ({ type: 'object', properties, required, additionalProperties: false });
const PROFILE_ID = text('Id of the profile (from list_profiles).');
const TAB_ID = text('Id of the tab (from list_tabs or open_tab).');

const PRESET = text('Id of a ready-made setup (from list_presets) to make the device from, e.g. windows-laptop.');

const PROFILE_FIELDS: Json = {
  name: text('Name shown in the manager.'),
  notes: text('Free notes.'),
  tags: { type: 'array', items: { type: 'string' }, description: 'Labels for finding the profile, e.g. ["shop", "client A"].' },
  os: { type: 'string', enum: ['windows', 'macos', 'linux', 'android', 'ios'],
        description: 'System the profile presents itself as. android is Chrome on a phone; ios is Safari on an iPhone.' },
  languages: { type: 'array', items: { type: 'string' }, description: 'Language tags, most preferred first, e.g. ["de-DE","de","en"].' },
  timezone: text('IANA time zone, e.g. Europe/Berlin. Empty means the machine\'s.'),
  proxy: { type: ['object', 'null'], description: 'Proxy for this profile, or null for none.',
           properties: { type: { type: 'string', enum: ['http', 'socks5'] }, host: { type: 'string' }, port: { type: 'integer' },
                         username: { type: 'string' }, password: { type: 'string' } } },
  matchProxy: { type: 'boolean', description: 'Before each start, match time zone, location and WebRTC address to where the proxy comes out.' },
  webrtc: { type: 'string', enum: ['proxyOnly', 'real'], description: 'proxyOnly never reveals the machine\'s address.' },
  webrtcPublicIp: text('Public address to show in WebRTC while protected.'),
  geolocation: { type: ['object', 'null'], description: 'Position reported to sites allowed to ask, or null for the machine\'s.',
                 properties: { latitude: { type: 'number' }, longitude: { type: 'number' }, accuracy: { type: 'number' } } },
  startUrl: text('Page opened when the profile starts.'),
  cameraFile: text('Path of a .y4m or .mjpeg video on this machine, shown to pages as the picture of the camera (the microphone is then silent), or "machine" for the camera and microphone of the machine. Empty: a covered lens and a silent microphone, or the own devices of the machine for a profile that has none of its own.'),
};

/** The DevTools address of a running profile; a clear error when it is not running. */
function debuggerOf(context: McpContext, id: unknown): string {
  const status = context.launcher.status(String(id));
  if (status.state !== 'running' || !status.debuggerUrl) {
    throw new Error('That profile is not running. Start it with start_profile first.');
  }
  return status.debuggerUrl;
}

/** A profile with its state, in the one shape the API uses too: `state` and `status` beside its fields. */
async function withState(context: McpContext, profile: Profile) {
  return { ...profile, ...entryStateOf(await context.launcher.statusOf(profile)) };
}

async function profileWithStatus(context: McpContext, id: string) {
  return withState(context, await context.store.getProfile(id));
}

/** What start_profile and stop_profile return: the details, and the one shape around them. */
async function statusReply(context: McpContext, id: string) {
  const status = await context.launcher.statusOf(await context.store.getProfile(id));
  return { ...status, ...stateOf(status) };
}

/** A profile as lists show it: enough to pick one, without its whole identity. */
function summary(profile: Awaited<ReturnType<typeof profileWithStatus>>) {
  return {
    id: profile.id, name: profile.name, tags: profile.tags, os: profile.os, state: profile.status.state,
    screen: `${profile.screen.width}x${profile.screen.height}` +
        (profile.screen.devicePixelRatio ? ` @${profile.screen.devicePixelRatio}x` : ''), timezone: profile.timezone,
    proxy: profile.proxy ? `${profile.proxy.type}://${profile.proxy.host}:${profile.proxy.port}` : null,
    // Where the proxy comes out (running), or came out the last time it was asked (stopped).
    ...(profile.status.proxyExit ? { proxyExit: profile.status.proxyExit } : {}),
    ...(profile.status.lastProxyExit ? { lastProxyExit: profile.status.lastProxyExit } : {}),
    ...(profile.status.exitNow ? { exitNow: profile.status.exitNow } : {}),
    ...(profile.status.exitProblem ? { exitProblem: profile.status.exitProblem } : {}),
    ...(profile.status.debuggerUrl ? { debuggerUrl: profile.status.debuggerUrl } : {}),
  };
}

export const TOOLS: readonly Tool[] = [
  {
    name: 'list_profiles',
    description: 'Lists the browser profiles with their state (running or stopped) and, for one with a proxy, the address it comes out on.',
    inputSchema: object({}),
    run: async (_args, context) => {
      const profiles = await context.store.listProfiles();
      return Promise.all(profiles.map(async (p) => summary(await withState(context, p))));
    },
  },
  {
    name: 'get_profile',
    description: 'Returns everything about one profile: its device identity, proxy and status.',
    inputSchema: object({ id: PROFILE_ID }, ['id']),
    run: (args, context) => profileWithStatus(context, String(args.id)),
  },
  {
    name: 'create_profile',
    description: 'Creates a profile. A coherent device identity (browser, screen, graphics card, fonts, noise seed) is ' +
        'generated for the chosen system, or taken from a ready-made setup (preset) or a stored device reading (deviceId).',
    inputSchema: object({ ...PROFILE_FIELDS, preset: PRESET,
                          deviceId: text('Id of a stored device reading (from list_devices) to take the identity from.') }, ['name']),
    run: async (args, context) => {
      const deviceId = args.deviceId === undefined ? undefined : String(args.deviceId);
      const preset = args.preset === undefined ? undefined : String(args.preset);
      return withState(context, await context.store.createProfile(toProfileInput(args), deviceId, preset));
    },
  },
  {
    name: 'create_profiles',
    description: 'Creates several profiles at once, named "<name> 1", "<name> 2", ..., each with a device identity of its own ' +
        'and, when proxies are given, a proxy of its own (the first profile gets the first proxy, and so on).',
    inputSchema: object({
      count: { type: 'integer', description: 'How many profiles to create (1 to 200).' },
      name: text('What they are called; a number is added to each.'),
      common: { type: 'object', description: 'Fields every profile gets: os, languages, timezone, tags, startUrl, webrtc.', properties: PROFILE_FIELDS },
      deviceId: text('Id of a stored device reading all of them take their identity from.'),
      preset: PRESET,
      proxies: { type: ['string', 'array'], description: 'Proxies: text with one per line (host:port:user:password and similar), or a list of proxy objects.' },
      proxyType: { type: 'string', enum: ['http', 'socks5'], description: 'Kind of the proxies in a text list that does not say. Default http.' },
      shareProxies: { type: 'boolean', description: 'Allow fewer proxies than profiles. Off by default: profiles sharing an address are linked by it.' },
    }, ['count']),
    run: async (args, context) => {
      const { deviceId, ...rest } = args;
      const made = await createProfiles(context.store, { ...rest, fingerprintId: deviceId } as unknown as BulkRequest);
      return Promise.all(made.map(async (p) => summary(await withState(context, p))));
    },
  },
  {
    name: 'duplicate_profile',
    description: 'Makes a new profile with the settings of an existing one (proxy, place, tags, start page) and a device identity of its own. Cookies are not copied.',
    inputSchema: object({ id: PROFILE_ID }, ['id']),
    run: async (args, context) => profileWithStatus(context, (await context.store.duplicateProfile(String(args.id))).id),
  },
  {
    name: 'update_profile',
    description: 'Changes fields of a profile (name, proxy, time zone, languages, start page, ...). Takes effect at its next start.',
    inputSchema: object({ id: PROFILE_ID, ...PROFILE_FIELDS }, ['id']),
    run: async (args, context) => {
      const { id, ...fields } = args;
      await context.store.updateProfile(String(id), toProfileInput(fields));
      return profileWithStatus(context, String(id));
    },
  },
  {
    name: 'delete_profile',
    description: 'Deletes a stopped profile together with its browser data (cookies, history). Cannot be undone.',
    inputSchema: object({ id: PROFILE_ID }, ['id']),
    run: async (args, context) => {
      const id = String(args.id);
      if (context.launcher.isRunning(id)) throw new Error('Stop the profile before deleting it.');
      await context.store.deleteProfile(id);
      return { deleted: id };
    },
  },
  {
    name: 'start_profile',
    description: 'Starts the browser for a profile and returns its status, including the DevTools address.',
    inputSchema: object({ id: PROFILE_ID }, ['id']),
    run: async (args, context) => {
      await context.launcher.start(await context.store.getProfile(String(args.id)));
      return statusReply(context, String(args.id));
    },
  },
  {
    name: 'stop_profile',
    description: 'Closes the browser of a running profile. Its cookies and storage are kept.',
    inputSchema: object({ id: PROFILE_ID }, ['id']),
    run: async (args, context) => {
      await context.store.getProfile(String(args.id));
      await context.launcher.stop(String(args.id));
      return statusReply(context, String(args.id));
    },
  },
  {
    name: 'new_identity',
    description: 'Gives a stopped profile a freshly generated device identity. Sites will see a different device; cookies are kept.',
    inputSchema: object({ id: PROFILE_ID }, ['id']),
    run: async (args, context) => {
      const id = String(args.id);
      if (context.launcher.isRunning(id)) throw new Error('Stop the profile before changing its identity.');
      const current = await context.store.getProfile(id);
      const settings = await context.store.getSettings();
      await context.store.updateProfile(id, generateIdentity(current.os, settings.kernelVersion));
      return profileWithStatus(context, id);
    },
  },
  {
    name: 'transport_report',
    description: "Measures how a profile's browser introduces itself to a server (its TLS hello as a JA4 fingerprint, and the opening of its HTTP/2 connection) and says whether that agrees with the browser version the profile claims. Works on a running or stopped profile; takes a few seconds; contacts nothing outside this machine.",
    inputSchema: object({ id: PROFILE_ID }, ['id']),
    run: async (args, context) => context.launcher.transport(await context.store.getProfile(String(args.id))),
  },
  {
    name: 'list_presets',
    description: 'Lists the ready-made setups (ordinary laptops, desktops and phones) a profile can be made from with create_profile.',
    inputSchema: object({}),
    run: async () => listPresets(),
  },
  {
    name: 'list_devices',
    description: 'Lists the stored readings of real devices that profiles can take their identity from.',
    inputSchema: object({}),
    run: async (_args, context) => (await context.store.listFingerprints()).map((stored) => ({
      id: stored.id, label: stored.collected.label, addedAt: stored.addedAt, ...describeCollected(stored.collected),
    })),
  },
  {
    name: 'delete_device',
    description: 'Removes a stored device reading. Profiles already made from it are not affected.',
    inputSchema: object({ id: text('Id of the device reading (from list_devices).') }, ['id']),
    run: async (args, context) => {
      await context.store.deleteFingerprint(String(args.id));
      return { deleted: String(args.id) };
    },
  },
  {
    name: 'get_settings',
    description: 'Returns the manager settings: kernel path and version, extra launch arguments.',
    inputSchema: object({}),
    run: (_args, context) => context.store.getSettings(),
  },
  {
    name: 'update_settings',
    description: 'Changes manager settings.',
    inputSchema: object({
      kernelPath: text('Path of the kernel program (chrome / chrome.exe).'),
      kernelVersion: text('Version of that kernel, e.g. 157.0.8103.79. Read from the kernel itself when it can be.'),
      extraArgs: { type: 'array', items: { type: 'string' }, description: 'Extra arguments for every launch.' },
      exitLookupUrl: text('Services asked for a proxy\'s exit address and time zone, separated by spaces; empty turns the lookup off.'),
      exitWatchMinutes: { type: 'number', description: 'How often, in minutes, a running profile\'s proxy exit is looked at again; 0 turns that off.' },
      exitCacheMinutes: { type: 'number', description: 'How long, in minutes, a proxy exit seen twice in a row lets a profile start without waiting for the lookup; 0 looks first at every start.' },
      autoUpdateCheck: { type: 'boolean', description: 'Whether the manager asks GitHub by itself, at a start and once a day, if there is a newer release. Nothing is downloaded until the user says so.' },
    }),
    run: (args, context) => context.store.updateSettings(args),
  },
  {
    name: 'check_proxy',
    description: 'Tries a proxy and reports where it comes out (address, time zone, position) and how long that took. ' +
        'Give the id of a profile to try its proxy, or a proxy to try before using it.',
    inputSchema: object({ id: text('Id of a profile whose proxy to try.'), proxy: PROFILE_FIELDS.proxy }),
    run: async (args, context) => {
      const proxy = args.id !== undefined ? (await context.store.getProfile(String(args.id))).proxy : args.proxy;
      if (proxy === null || proxy === undefined) throw new Error('There is no proxy to check: give a profile that has one, or a proxy.');
      validateProxy(proxy);
      const check = await checkProxy(proxy, (await context.store.getSettings()).exitLookupUrl);
      const { ms: _ms, ...exit } = check;
      await context.launcher.noteExit(proxy, exit);
      return check;
    },
  },
  {
    name: 'list_tabs',
    description: 'Lists the tabs open in a running profile.',
    inputSchema: object({ id: PROFILE_ID }, ['id']),
    run: (args, context) => browser.listTabs(debuggerOf(context, args.id)),
  },
  {
    name: 'open_tab',
    description: 'Opens a new tab in a running profile, on the given address.',
    inputSchema: object({ id: PROFILE_ID, url: text('Address to open (http or https). Defaults to a blank tab.') }, ['id']),
    run: (args, context) => browser.openTab(debuggerOf(context, args.id), args.url ?? 'about:blank'),
  },
  {
    name: 'close_tab',
    description: 'Closes a tab of a running profile.',
    inputSchema: object({ id: PROFILE_ID, tabId: TAB_ID }, ['id', 'tabId']),
    run: async (args, context) => {
      await browser.closeTab(debuggerOf(context, args.id), String(args.tabId));
      return { closed: String(args.tabId) };
    },
  },
  {
    name: 'navigate',
    description: 'Sends a tab to an address and waits for the page to load.',
    inputSchema: object({ id: PROFILE_ID, tabId: TAB_ID, url: text('Address to go to (http or https).') }, ['id', 'tabId', 'url']),
    run: (args, context) => browser.navigate(debuggerOf(context, args.id), String(args.tabId), args.url),
  },
  {
    name: 'page_text',
    description: 'Returns the title, address and visible text of the page in a tab.',
    inputSchema: object({ id: PROFILE_ID, tabId: TAB_ID }, ['id', 'tabId']),
    run: (args, context) => browser.pageText(debuggerOf(context, args.id), String(args.tabId)),
  },
  {
    name: 'evaluate',
    description: 'Runs JavaScript in the page of a tab and returns the value of the expression (awaited if it is a promise). ' +
        'Use it to read the page, fill fields or click: e.g. document.querySelector("button").click().',
    inputSchema: object({ id: PROFILE_ID, tabId: TAB_ID, expression: text('JavaScript to evaluate in the page.') }, ['id', 'tabId', 'expression']),
    run: async (args, context) => ({ value: await browser.evaluate(debuggerOf(context, args.id), String(args.tabId), args.expression) ?? null }),
  },
  {
    name: 'screenshot',
    description: 'Returns a picture of what a tab shows.',
    inputSchema: object({ id: PROFILE_ID, tabId: TAB_ID, fullPage: { type: 'boolean', description: 'Capture the whole page, not only the visible part.' } }, ['id', 'tabId']),
    run: async (args, context) => new Picture(await browser.screenshot(debuggerOf(context, args.id), String(args.tabId), args.fullPage === true)),
  },
  {
    name: 'get_cookies',
    description: 'Returns every cookie a running profile holds.',
    inputSchema: object({ id: PROFILE_ID }, ['id']),
    run: (args, context) => browser.getCookies(debuggerOf(context, args.id)),
  },
  {
    name: 'set_cookies',
    description: 'Adds cookies to a running profile, for example a session exported from another browser.',
    inputSchema: object({
      id: PROFILE_ID,
      cookies: { type: 'array', description: 'Cookies to add.', items: object({
        name: { type: 'string' }, value: { type: 'string' }, domain: { type: 'string' }, path: { type: 'string' },
        expires: { type: 'number', description: 'Seconds since 1970; leave out for a session cookie.' },
        httpOnly: { type: 'boolean' }, secure: { type: 'boolean' }, sameSite: { type: 'string', enum: ['Strict', 'Lax', 'None'] },
      }, ['name', 'value', 'domain']) },
    }, ['id', 'cookies']),
    run: async (args, context) => ({ added: await browser.setCookies(debuggerOf(context, args.id), args.cookies) }),
  },
];

async function callTool(params: Json, context: McpContext): Promise<{ content: Content[]; isError?: boolean }> {
  const tool = TOOLS.find((candidate) => candidate.name === params.name);
  if (!tool) return { content: [{ type: 'text', text: `There is no tool named "${String(params.name)}".` }], isError: true };
  const args = typeof params.arguments === 'object' && params.arguments !== null ? params.arguments as Json : {};
  for (const needed of (tool.inputSchema.required as string[])) {
    if (args[needed] === undefined) return { content: [{ type: 'text', text: `${tool.name} needs "${needed}".` }], isError: true };
  }
  try {
    const result = await tool.run(args, context);
    if (result instanceof Picture) return { content: [{ type: 'image', data: result.png.toString('base64'), mimeType: 'image/png' }] };
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  } catch (error) {
    // A tool that fails tells the assistant why, so that it can correct itself.
    return { content: [{ type: 'text', text: (error as Error).message }], isError: true };
  }
}

async function handleOne(message: unknown, context: McpContext): Promise<Json | undefined> {
  if (typeof message !== 'object' || message === null || Array.isArray(message)) {
    return { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid request' } };
  }
  const { id, method, params } = message as { id?: unknown; method?: unknown; params?: Json };
  const reply = (result: unknown): Json => ({ jsonrpc: '2.0', id, result });
  // A message without an id is a notification: it gets no reply.
  if (id === undefined) return undefined;
  switch (method) {
    case 'initialize': {
      const asked = String(params?.protocolVersion ?? '');
      return reply({
        protocolVersion: PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0],
        capabilities: { tools: {} },
        serverInfo: SERVER_INFO,
        instructions: 'Proteus runs browser profiles that each look like a different device. List or create a profile, ' +
            'start it, then use the tab tools (open_tab, navigate, page_text, evaluate, screenshot) on it. Stop it when done.',
      });
    }
    case 'ping':
      return reply({});
    case 'tools/list':
      return reply({ tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) });
    case 'tools/call':
      return reply(await callTool(params ?? {}, context));
    default:
      return { jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${String(method)}` } };
  }
}

/**
 * Answers one MCP request body (a message, or a batch of them). Returns undefined
 * when there is nothing to send back, which is the case for notifications.
 */
export async function handleMcp(body: unknown, context: McpContext): Promise<Json | Json[] | undefined> {
  if (Array.isArray(body)) {
    const replies = (await Promise.all(body.map((message) => handleOne(message, context)))).filter((r) => r !== undefined);
    return replies.length > 0 ? replies as Json[] : undefined;
  }
  return handleOne(body, context);
}

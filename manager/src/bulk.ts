// Making many profiles at once: each with a device identity of its own and, when a
// list of proxies is given, a proxy of its own.

import { type Profile, type ProxySettings, validateProxy, ValidationError } from './profile.ts';
import { toProfileInput } from './profileInput.ts';
import { parseProxyList } from './proxyList.ts';
import type { Store } from './store.ts';

const MAX_AT_ONCE = 200;

export interface BulkRequest {
  /** How many profiles to make. */
  count: number;
  /** They are named "<name> 1", "<name> 2", ... */
  name?: string;
  /** Fields every one of them gets (system, languages, tags, start page, ...). */
  common?: unknown;
  /** A stored device reading all of them take their identity from, instead of generated ones. */
  fingerprintId?: string;
  /** Proxies, as pasted text (one per line) or as a list. The first profile gets the first, and so on. */
  proxies?: string | unknown[];
  /** Kind of the proxies in a pasted list that does not say. */
  proxyType?: ProxySettings['type'];
  /** Allow fewer proxies than profiles, handing them out in turn. Off by default: accounts sharing an address are linked by it. */
  shareProxies?: boolean;
}

/**
 * Creates the profiles of `request`. Everything is checked before the first one is
 * made, and if one fails anyway the ones already made are removed again, so a
 * request leaves either all of its profiles or none.
 */
export async function createProfiles(store: Store, request: BulkRequest): Promise<Profile[]> {
  if (!Number.isInteger(request.count) || request.count < 1 || request.count > MAX_AT_ONCE) {
    throw new ValidationError(`count must be a whole number from 1 to ${MAX_AT_ONCE}`);
  }
  const name = (request.name ?? 'Profile').trim();
  if (name === '' || name.length > 180) throw new ValidationError('name must be 1 to 180 characters');
  const common = toProfileInput(request.common ?? {});
  delete common.name;
  delete common.seed;

  let proxies: ProxySettings[] = [];
  if (typeof request.proxies === 'string') {
    proxies = parseProxyList(request.proxies, request.proxyType ?? 'http');
  } else if (Array.isArray(request.proxies)) {
    proxies = request.proxies.map((proxy) => { validateProxy(proxy); return proxy; });
  } else if (request.proxies !== undefined) {
    throw new ValidationError('proxies must be text with one proxy per line, or a list');
  }
  if (proxies.length > 0 && proxies.length < request.count && request.shareProxies !== true) {
    throw new ValidationError(`${request.count} profiles need ${request.count} proxies, and ${proxies.length} were given. ` +
        'Profiles that share an address are linked by it; give one each, or allow sharing.');
  }

  const made: Profile[] = [];
  try {
    for (let index = 0; index < request.count; index++) {
      const input = { ...common, name: `${name} ${index + 1}` };
      if (proxies.length > 0) input.proxy = { ...proxies[index % proxies.length] };
      made.push(await store.createProfile(input, request.fingerprintId));
    }
  } catch (error) {
    for (const profile of made) await store.deleteProfile(profile.id).catch(() => {});
    throw error;
  }
  return made;
}

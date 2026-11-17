// Remembers where each proxy came out the last time it was asked.
//
// Two things use it. A stopped profile can still say which address it last came out
// on. And a start need not wait for the lookup when the answer is already known: a
// proxy whose exit was the same at the last two looks is taken to still be there for
// a while (Settings.exitCacheMinutes), and is checked again while the browser comes
// up. A proxy that hands out a new address on every connection never looks the same
// twice, so it is always asked first, as before.
//
// Kept in <data dir>/exits.json, keyed by a hash of the proxy (never its password).

import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import type { ProxySettings } from './profile.ts';
import type { ProxyExit } from './proxyExit.ts';

export interface RememberedExit {
  exit: ProxyExit;
  /** When it was last seen, as an ISO time. */
  at: string;
  /** True once two looks in a row found this address. */
  confirmed: boolean;
}

const MAX_ENTRIES = 1000;

/**
 * Names a proxy without holding its login: the same proxy with the same login always
 * gives the same key, and another password (which a provider may tie to another exit,
 * or which may simply be wrong) gives another.
 */
export function proxyKey(proxy: ProxySettings): string {
  return createHash('sha256')
      .update(JSON.stringify([proxy.type, proxy.host.toLowerCase(), proxy.port, proxy.username ?? '', proxy.password ?? '']))
      .digest('hex').slice(0, 32);
}

/** The address sites reached over IPv4 see, which is what tells two exits apart. */
export function exitAddress(exit: ProxyExit): string {
  return exit.ipv4 ?? exit.ip;
}

export class ExitMemory {
  private readonly file: string;
  private entries: Map<string, RememberedExit> | undefined;
  private writing: Promise<void> = Promise.resolve();

  constructor(file: string) {
    this.file = file;
  }

  private async load(): Promise<Map<string, RememberedExit>> {
    if (this.entries) return this.entries;
    const entries = new Map<string, RememberedExit>();
    try {
      const stored = JSON.parse(await readFile(this.file, 'utf8')) as Record<string, RememberedExit>;
      for (const [key, entry] of Object.entries(stored)) {
        if (typeof entry?.exit?.ip === 'string' && typeof entry.at === 'string') entries.set(key, entry);
      }
    } catch {
      // No file yet, or one that cannot be read: start with nothing remembered.
    }
    // Two callers may get here together; the first map set is the one kept.
    this.entries ??= entries;
    return this.entries;
  }

  /** What is remembered for `key`, however old. */
  async get(key: string): Promise<RememberedExit | undefined> {
    return (await this.load()).get(key);
  }

  /**
   * What is remembered for `key`, if it may stand in for a look: seen twice in a row
   * and no older than `maxMinutes` at `now`.
   */
  async fresh(key: string, maxMinutes: number, now: number = Date.now()): Promise<RememberedExit | undefined> {
    const entry = await this.get(key);
    if (!entry || maxMinutes <= 0 || !entry.confirmed) return undefined;
    const age = now - Date.parse(entry.at);
    return age >= 0 && age <= maxMinutes * 60_000 ? entry : undefined;
  }

  /** Records that a look at `key` found `exit` just now. */
  async note(key: string, exit: ProxyExit, now: number = Date.now()): Promise<RememberedExit> {
    const entries = await this.load();
    const before = entries.get(key);
    const entry: RememberedExit = {
      exit, at: new Date(now).toISOString(),
      confirmed: before !== undefined && exitAddress(before.exit) === exitAddress(exit),
    };
    entries.delete(key);  // Re-inserted at the end: the map stays ordered oldest first.
    entries.set(key, entry);
    while (entries.size > MAX_ENTRIES) entries.delete(entries.keys().next().value as string);
    this.writing = this.writing.then(() => this.save(entries)).catch(() => {});
    await this.writing;
    return entry;
  }

  private async save(entries: Map<string, RememberedExit>): Promise<void> {
    await mkdir(dirname(this.file), { recursive: true });
    const temp = `${this.file}.${process.pid}.tmp`;
    await writeFile(temp, JSON.stringify(Object.fromEntries(entries)) + '\n', 'utf8');
    await rename(temp, this.file);
  }
}

// File-backed storage. Layout under the data directory:
//   settings.json
//   profiles/<id>/profile.json     the profile itself
//   profiles/<id>/kernel.json      kernel config written at each launch
//   profiles/<id>/browser/         Chromium user data (cookies, history, ...)
//   fingerprints/<id>.json         a fingerprint read from a real device

import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { classify, type Collected, identityFromCollected, parseCollected } from './collected.ts';
import { generateIdentity, hostOs } from './fingerprint.ts';
import { OS_FAMILIES, type Profile, type ProfileInput, ValidationError, validateProfile } from './profile.ts';

export interface Settings {
  /** Path to the Proteus kernel executable (chrome / chrome.exe). */
  kernelPath: string;
  /** Version of that kernel; generated user agents are built to match it. */
  kernelVersion: string;
  /** Extra command-line arguments passed to every launch. */
  extraArgs: string[];
  /**
   * Services asked, through a profile's proxy, for the proxy's exit address and time
   * zone: one or more addresses separated by spaces, tried in turn until one answers
   * (a proxy's exits cannot always reach every service). Each must answer with JSON
   * holding `ip` and `timezone` (or `timezone.id`). Empty turns the lookup off.
   */
  exitLookupUrl: string;
}

/** The lookup setting of versions that asked a single service. */
const SINGLE_LOOKUP_DEFAULT = 'https://ipwho.is/';

const DEFAULT_SETTINGS: Settings = {
  kernelPath: '', kernelVersion: '158.0.8127.37', extraArgs: [],
  exitLookupUrl: 'https://ipwho.is/ https://api.ip.sb/geoip https://ipapi.co/json/ https://ipinfo.io/json',
};

/** A fingerprint read from a real device (see collected.ts), as kept on disk. */
export interface StoredFingerprint {
  id: string;
  addedAt: string;
  /** Of the device's values alone, so the same reading is not stored twice. */
  hash: string;
  collected: Collected;
}

export class NotFoundError extends Error {}

export function defaultDataDir(): string {
  if (process.env.PROTEUS_HOME) return process.env.PROTEUS_HOME;
  if (process.platform === 'win32' && process.env.APPDATA) return join(process.env.APPDATA, 'Proteus');
  return join(homedir(), '.proteus');
}

async function readJson<T>(file: string): Promise<T | undefined> {
  try {
    return JSON.parse(await readFile(file, 'utf8')) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

/** Writes via a temporary file so a crash cannot leave a half-written JSON file. */
async function writeJson(file: string, value: unknown): Promise<void> {
  const temp = `${file}.${process.pid}.tmp`;
  await writeFile(temp, JSON.stringify(value, null, 2) + '\n', 'utf8');
  await rename(temp, file);
}

const ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Values for fields added after a profile was saved, so older profiles keep loading. */
const FIELD_DEFAULTS: Pick<Profile, 'webrtc' | 'webrtcPublicIp' | 'fonts' | 'voices' | 'webgpu' | 'matchProxy' | 'geolocation' | 'mobile' | 'webglCaps'> = {
  webrtc: 'proxyOnly',
  webrtcPublicIp: '',
  fonts: [],
  voices: [],
  webgpu: { vendor: '', architecture: '' },
  // Profiles saved before this existed keep starting exactly as they did.
  matchProxy: false,
  geolocation: null,
  mobile: null,
  webglCaps: null,
};

function withDefaults(stored: Profile): Profile {
  return { ...FIELD_DEFAULTS, ...stored };
}

export class Store {
  readonly dataDir: string;

  constructor(dataDir: string = defaultDataDir()) {
    this.dataDir = dataDir;
  }

  private get profilesDir(): string {
    return join(this.dataDir, 'profiles');
  }

  /** Directory of one profile. Rejects ids that are not UUIDs, so an id can never escape the data directory. */
  profileDir(id: string): string {
    if (!ID_PATTERN.test(id)) throw new NotFoundError(`no profile with id "${id}"`);
    return join(this.profilesDir, id);
  }

  async getSettings(): Promise<Settings> {
    const stored = await readJson<Partial<Settings>>(join(this.dataDir, 'settings.json'));
    const settings = { ...DEFAULT_SETTINGS, ...stored };
    // Settings saved when only one service was asked move to the list of them.
    if (settings.exitLookupUrl === SINGLE_LOOKUP_DEFAULT) settings.exitLookupUrl = DEFAULT_SETTINGS.exitLookupUrl;
    return settings;
  }

  async updateSettings(patch: Partial<Settings>): Promise<Settings> {
    const next = { ...(await this.getSettings()) };
    if (patch.kernelPath !== undefined) {
      if (typeof patch.kernelPath !== 'string') throw new ValidationError('kernelPath must be a string');
      next.kernelPath = patch.kernelPath;
    }
    if (patch.kernelVersion !== undefined) {
      if (typeof patch.kernelVersion !== 'string' || !/^\d+\.\d+\.\d+\.\d+$/.test(patch.kernelVersion)) {
        throw new ValidationError('kernelVersion must look like 158.0.8127.37');
      }
      next.kernelVersion = patch.kernelVersion;
    }
    if (patch.extraArgs !== undefined) {
      if (!Array.isArray(patch.extraArgs) || patch.extraArgs.some((arg) => typeof arg !== 'string')) {
        throw new ValidationError('extraArgs must be a list of strings');
      }
      next.extraArgs = patch.extraArgs;
    }
    if (patch.exitLookupUrl !== undefined) {
      if (typeof patch.exitLookupUrl !== 'string' || patch.exitLookupUrl.length > 2000 ||
          !patch.exitLookupUrl.split(/\s+/).filter(Boolean).every((url) => /^https?:\/\/[^\s]+$/i.test(url))) {
        throw new ValidationError('exitLookupUrl must be http(s) URLs separated by spaces, or empty');
      }
      next.exitLookupUrl = patch.exitLookupUrl.trim();
    }
    await mkdir(this.dataDir, { recursive: true });
    await writeJson(join(this.dataDir, 'settings.json'), next);
    return next;
  }

  async listProfiles(): Promise<Profile[]> {
    let ids: string[];
    try {
      ids = await readdir(this.profilesDir);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
    const profiles: Profile[] = [];
    for (const id of ids) {
      if (!ID_PATTERN.test(id)) continue;
      const profile = await readJson<Profile>(join(this.profilesDir, id, 'profile.json'));
      if (profile) profiles.push(withDefaults(profile));
    }
    return profiles.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async getProfile(id: string): Promise<Profile> {
    const profile = await readJson<Profile>(join(this.profileDir(id), 'profile.json'));
    if (!profile) throw new NotFoundError(`no profile with id "${id}"`);
    return withDefaults(profile);
  }

  private get fingerprintsDir(): string {
    return join(this.dataDir, 'fingerprints');
  }

  private fingerprintFile(id: string): string {
    if (!ID_PATTERN.test(id)) throw new NotFoundError(`no fingerprint with id "${id}"`);
    return join(this.fingerprintsDir, `${id}.json`);
  }

  /**
   * Stores a fingerprint read by the collector page. `raw` is untrusted; it is
   * checked, and refused if no profile could be made from it. Adding the same
   * reading twice returns the stored one.
   */
  async addFingerprint(raw: unknown): Promise<StoredFingerprint> {
    const collected = parseCollected(raw);
    classify(collected);
    const { collectedAt: _at, label: _label, ...device } = collected;
    const hash = createHash('sha256').update(JSON.stringify(device)).digest('hex');
    for (const existing of await this.listFingerprints()) {
      if (existing.hash === hash) return existing;
    }
    const stored: StoredFingerprint = { id: randomUUID(), addedAt: new Date().toISOString(), hash, collected };
    await mkdir(this.fingerprintsDir, { recursive: true });
    await writeJson(this.fingerprintFile(stored.id), stored);
    return stored;
  }

  async listFingerprints(): Promise<StoredFingerprint[]> {
    let files: string[];
    try {
      files = await readdir(this.fingerprintsDir);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
    const fingerprints: StoredFingerprint[] = [];
    for (const file of files) {
      if (!file.endsWith('.json') || !ID_PATTERN.test(file.slice(0, -5))) continue;
      const stored = await readJson<StoredFingerprint>(join(this.fingerprintsDir, file));
      if (stored) fingerprints.push(stored);
    }
    return fingerprints.sort((a, b) => a.addedAt.localeCompare(b.addedAt));
  }

  async getFingerprint(id: string): Promise<StoredFingerprint> {
    const stored = await readJson<StoredFingerprint>(this.fingerprintFile(id));
    if (!stored) throw new NotFoundError(`no fingerprint with id "${id}"`);
    return stored;
  }

  /** Removes a stored fingerprint. Profiles already made from it are not affected. */
  async deleteFingerprint(id: string): Promise<void> {
    await this.getFingerprint(id);
    await rm(this.fingerprintFile(id), { force: true });
  }

  /**
   * Creates a profile; `input` overrides any field of its identity. The identity is
   * that of the stored fingerprint `fingerprintId` when one is given, and freshly
   * generated otherwise.
   */
  async createProfile(input: ProfileInput = {}, fingerprintId?: string): Promise<Profile> {
    const settings = await this.getSettings();
    const fromDevice = fingerprintId === undefined ? undefined
        : identityFromCollected((await this.getFingerprint(fingerprintId)).collected, settings.kernelVersion);
    const os = input.os ?? fromDevice?.os ?? hostOs();
    if (!OS_FAMILIES.includes(os)) {
      throw new ValidationError(`os must be one of ${OS_FAMILIES.join(', ')}`);
    }
    if (fromDevice && fromDevice.os !== os) {
      throw new ValidationError(`that fingerprint is of a ${fromDevice.os} device, not ${os}`);
    }
    const now = new Date().toISOString();
    const profile: Profile = {
      name: 'New profile',
      notes: '',
      languages: [],
      timezone: '',
      webrtc: FIELD_DEFAULTS.webrtc,
      webrtcPublicIp: FIELD_DEFAULTS.webrtcPublicIp,
      geolocation: null,
      proxy: null,
      matchProxy: true,
      startUrl: '',
      ...(fromDevice ?? generateIdentity(os, settings.kernelVersion)),
      ...input,
      id: randomUUID(),
      createdAt: now,
      updatedAt: now,
    };
    validateProfile(profile);
    await mkdir(this.profileDir(profile.id), { recursive: true });
    await writeJson(join(this.profileDir(profile.id), 'profile.json'), profile);
    return profile;
  }

  async updateProfile(id: string, input: ProfileInput): Promise<Profile> {
    const current = await this.getProfile(id);
    const profile: Profile = {
      ...current,
      ...input,
      id: current.id,
      createdAt: current.createdAt,
      updatedAt: new Date().toISOString(),
    };
    validateProfile(profile);
    await writeJson(join(this.profileDir(id), 'profile.json'), profile);
    return profile;
  }

  /** Deletes the profile together with its browser data. */
  async deleteProfile(id: string): Promise<void> {
    await this.getProfile(id);
    await rm(this.profileDir(id), { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
}

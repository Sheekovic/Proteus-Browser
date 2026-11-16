// File-backed storage. Layout under the data directory:
//   settings.json
//   profiles/<id>/profile.json     the profile itself
//   profiles/<id>/kernel.json      kernel config written at each launch
//   profiles/<id>/browser/         Chromium user data (cookies, history, ...)

import { randomUUID } from 'node:crypto';
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

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
   * Service asked, through a profile's proxy, for the proxy's exit address and time
   * zone. Must answer with JSON holding `ip` and `timezone` (or `timezone.id`).
   * Empty turns the lookup off.
   */
  exitLookupUrl: string;
}

const DEFAULT_SETTINGS: Settings = {
  kernelPath: '', kernelVersion: '158.0.8127.37', extraArgs: [], exitLookupUrl: 'https://ipwho.is/',
};

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
const FIELD_DEFAULTS: Pick<Profile, 'webrtc' | 'webrtcPublicIp' | 'fonts' | 'voices' | 'webgpu' | 'matchProxy' | 'geolocation' | 'mobile'> = {
  webrtc: 'proxyOnly',
  webrtcPublicIp: '',
  fonts: [],
  voices: [],
  webgpu: { vendor: '', architecture: '' },
  // Profiles saved before this existed keep starting exactly as they did.
  matchProxy: false,
  geolocation: null,
  mobile: null,
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
    return { ...DEFAULT_SETTINGS, ...stored };
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
      if (typeof patch.exitLookupUrl !== 'string' ||
          (patch.exitLookupUrl !== '' && !/^https?:\/\/[^\s]+$/i.test(patch.exitLookupUrl))) {
        throw new ValidationError('exitLookupUrl must be an http(s) URL, or empty');
      }
      next.exitLookupUrl = patch.exitLookupUrl;
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

  /** Creates a profile with a freshly generated identity; `input` overrides any generated field. */
  async createProfile(input: ProfileInput = {}): Promise<Profile> {
    const settings = await this.getSettings();
    const os = input.os ?? hostOs();
    if (!OS_FAMILIES.includes(os)) {
      throw new ValidationError(`os must be one of ${OS_FAMILIES.join(', ')}`);
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
      ...generateIdentity(os, settings.kernelVersion),
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

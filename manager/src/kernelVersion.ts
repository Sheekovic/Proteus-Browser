// Which Chromium release the kernel is, read from the kernel itself, and keeping what
// profiles claim in step with it.
//
// A profile says which Chrome it is (User-Agent, client hints); the kernel is one
// particular Chrome underneath. The two must be the same version: a browser that says
// 158 and behaves, feature for feature and handshake for handshake, like 157 is
// noticed. So the version is not left to a setting someone has to remember to change
// when the kernel is replaced: it is read from the kernel, and a Chrome profile made
// for another kernel is moved to this one when it starts.

import { execFile } from 'node:child_process';
import { readdir, stat } from 'node:fs/promises';
import { dirname } from 'node:path';

import type { Profile, UaBrand } from './profile.ts';

const VERSION = /\b(\d+\.\d+\.\d+\.\d+)\b/;
const seen = new Map<string, { mtimeMs: number; version: string | undefined }>();

/**
 * The version of the kernel at `kernelPath` ("157.0.8103.79"), or undefined when it
 * cannot be told. On Windows a Chromium build has a file named after its version
 * beside the executable (157.0.8103.79.manifest); elsewhere the executable is asked
 * (`chrome --version` prints it and exits without opening anything).
 */
export async function readKernelVersion(kernelPath: string, platform: NodeJS.Platform = process.platform): Promise<string | undefined> {
  let mtimeMs: number;
  try {
    mtimeMs = (await stat(kernelPath)).mtimeMs;
  } catch {
    return undefined;
  }
  const known = seen.get(kernelPath);
  if (known && known.mtimeMs === mtimeMs) return known.version;
  let version: string | undefined;
  try {
    const manifests = (await readdir(dirname(kernelPath)))
        .map((name) => /^(\d+\.\d+\.\d+\.\d+)\.manifest$/.exec(name)?.[1])
        .filter((found): found is string => found !== undefined);
    if (manifests.length === 1) version = manifests[0];
  } catch {
    // No folder to look in.
  }
  if (version === undefined && platform !== 'win32') {
    version = await new Promise<string | undefined>((resolve) => {
      execFile(kernelPath, ['--version'], { timeout: 5000 }, (error, stdout) => {
        resolve(error ? undefined : VERSION.exec(String(stdout))?.[1]);
      });
    });
  }
  seen.set(kernelPath, { mtimeMs, version });
  return version;
}

/**
 * What to change on `profile` so that it claims the Chrome the kernel is, or null
 * when it already does or is not a Chrome profile (an iPhone profile claims Safari,
 * and keeps doing so). Only the version moves: the system, the device and everything
 * else a profile is stay as they are, as they do when a real Chrome updates itself.
 */
export function alignToKernel(profile: Pick<Profile, 'userAgent' | 'uaData'>, kernelVersion: string): Pick<Profile, 'userAgent' | 'uaData'> | null {
  const claimed = /\bChrome\/(\d+)\.0\.0\.0\b/.exec(profile.userAgent);
  // Browsers that put a version of their own beside Chrome's are not ours to renumber.
  if (!claimed || /\b(?:Edg|EdgA|OPR|YaBrowser|SamsungBrowser)\//.test(profile.userAgent)) return null;
  const major = kernelVersion.split('.')[0];
  const oldMajor = claimed[1];
  const oldFull = profile.uaData.fullVersion;
  if (oldMajor === major && (oldFull === '' || oldFull === kernelVersion)) return null;
  // Lists written out by hand (profiles from before the kernel generated them): the
  // made-up "Not A Brand" entry has a version of its own and is left alone.
  const renumber = (list: UaBrand[], to: string) =>
    list.map((entry) => (/^\s*Not/i.test(entry.brand) || entry.version.split('.')[0] !== oldMajor ? entry : { ...entry, version: to }));
  return {
    userAgent: profile.userAgent.replace(/\bChrome\/\d+\.0\.0\.0\b/, `Chrome/${major}.0.0.0`),
    uaData: {
      ...profile.uaData,
      fullVersion: oldFull === '' ? '' : kernelVersion,
      brands: renumber(profile.uaData.brands, major),
      fullVersionList: renumber(profile.uaData.fullVersionList, kernelVersion),
    },
  };
}

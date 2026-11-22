// Is there a newer Proteus than this one?
//
// A release folder says which version it is in VERSION.txt, beside the manager. The
// releases are on GitHub, and their list is asked for only when the user asks: the
// manager contacts nothing by itself. What comes back is where to get the newer
// version; nothing is downloaded or replaced here.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Where the releases are listed, newest first. */
export const RELEASES_URL = 'https://api.github.com/repos/Sheekovic/Proteus-Browser/releases?per_page=20';
const RELEASES_PAGE = 'https://github.com/Sheekovic/Proteus-Browser/releases';

const VERSION = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.]+))?$/;

/**
 * The version of the release folder `managerDir` is in, e.g. "0.1.0-preview.5", or
 * null when it is not a release (a working tree, whose VERSION.txt says so in words,
 * or no file at all).
 */
export function bundleVersion(managerDir: string): string | null {
  try {
    const first = readFileSync(join(managerDir, '..', 'VERSION.txt'), 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/)[0].trim();
    return VERSION.test(first) ? first : null;
  } catch {
    return null;
  }
}

/**
 * Orders two versions: negative when `a` is the older. 0.1.0-preview.5 is older than
 * 0.1.0-preview.10 and both are older than 0.1.0, as a preview comes before what it
 * previews.
 */
export function compareVersions(a: string, b: string): number {
  const [, a1, a2, a3, aPre] = VERSION.exec(a) ?? [];
  const [, b1, b2, b3, bPre] = VERSION.exec(b) ?? [];
  for (const [x, y] of [[a1, b1], [a2, b2], [a3, b3]]) {
    if (Number(x) !== Number(y)) return Number(x) - Number(y);
  }
  if (aPre === undefined || bPre === undefined) return aPre === bPre ? 0 : aPre === undefined ? 1 : -1;
  const aParts = aPre.split('.'), bParts = bPre.split('.');
  for (let i = 0; i < Math.max(aParts.length, bParts.length); i++) {
    const x = aParts[i], y = bParts[i];
    if (x === undefined || y === undefined) return x === y ? 0 : x === undefined ? -1 : 1;
    const bothNumbers = /^\d+$/.test(x) && /^\d+$/.test(y);
    const order = bothNumbers ? Number(x) - Number(y) : x < y ? -1 : x > y ? 1 : 0;
    if (order !== 0) return order;
  }
  return 0;
}

export interface UpdateReport {
  /** This folder's version, or null when it is not a release. */
  current: string | null;
  /** The newest release there is, or null when the list could not be read. */
  latest: string | null;
  /** True when `latest` is newer than `current`. */
  newer: boolean;
  /** Where to get it. */
  page: string;
  /** When it was published (ISO 8601), when known. */
  published: string | null;
  /** In words. */
  message: string;
}

/** Asks GitHub for the releases and says whether one is newer than `current`. */
export async function checkForUpdate(current: string | null, fetcher: typeof fetch = fetch): Promise<UpdateReport> {
  const report: UpdateReport = { current, latest: null, newer: false, page: RELEASES_PAGE, published: null, message: '' };
  let releases: unknown;
  try {
    const response = await fetcher(RELEASES_URL, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Proteus' },
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error(`GitHub answered ${response.status}`);
    releases = await response.json();
  } catch (error) {
    report.message = `The list of releases could not be read: ${(error as Error).message}.`;
    return report;
  }
  let best: { version: string; page: string; published: string | null } | null = null;
  for (const release of Array.isArray(releases) ? releases : []) {
    if (typeof release !== 'object' || release === null || release.draft === true) continue;
    const version = String(release.tag_name ?? '').replace(/^v/, '');
    if (!VERSION.test(version)) continue;
    if (best === null || compareVersions(version, best.version) > 0) {
      best = {
        version,
        // Only a page on GitHub is handed on, whatever the answer holds.
        page: typeof release.html_url === 'string' && release.html_url.startsWith('https://github.com/') ? release.html_url : RELEASES_PAGE,
        published: typeof release.published_at === 'string' ? release.published_at : null,
      };
    }
  }
  if (best === null) {
    report.message = 'No release was found.';
    return report;
  }
  report.latest = best.version;
  report.page = best.page;
  report.published = best.published;
  if (current === null) {
    report.message = `The newest release is ${best.version}. This is not a release folder, so there is nothing to compare it with.`;
  } else if (compareVersions(best.version, current) > 0) {
    report.newer = true;
    report.message = `Version ${best.version} is out; this is ${current}.`;
  } else {
    report.message = `This is the newest version (${current}).`;
  }
  return report;
}

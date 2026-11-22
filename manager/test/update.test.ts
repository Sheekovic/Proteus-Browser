// Is there a newer Proteus: the version of a release folder, how versions are
// ordered, and what the answer from GitHub is turned into.

import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { bundleVersion, checkForUpdate, compareVersions, RELEASES_URL } from '../src/update.ts';

test('a release folder says which version it is; a working tree does not', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'proteus-update-'));
  const manager = join(dir, 'manager');
  await mkdir(manager);
  assert.equal(bundleVersion(manager), null, 'no file');
  await writeFile(join(dir, 'VERSION.txt'), '0.1.0-preview.6\n');
  assert.equal(bundleVersion(manager), '0.1.0-preview.6');
  await writeFile(join(dir, 'VERSION.txt'), '\uFEFFProteus, from this working tree\r\nupdated: 2026-11-22 11:51\r\n');
  assert.equal(bundleVersion(manager), null, 'the folder made from a working tree');
  await rm(dir, { recursive: true, force: true });
});

test('versions are ordered as their numbers are, a preview before what it previews', () => {
  const ordered = ['0.1.0-preview.5', '0.1.0-preview.6', '0.1.0-preview.10', '0.1.0-rc.1', '0.1.0', '0.1.1', '0.2.0-preview.1', '0.10.0', '1.0.0'];
  for (let i = 0; i < ordered.length; i++) {
    for (let j = 0; j < ordered.length; j++) {
      assert.equal(Math.sign(compareVersions(ordered[i], ordered[j])), Math.sign(i - j), `${ordered[i]} against ${ordered[j]}`);
    }
  }
});

const answering = (status: number, body: unknown, seen: string[] = []) => (async (url: string | URL | Request) => {
  seen.push(String(url));
  return new Response(JSON.stringify(body), { status });
}) as typeof fetch;

test('the newest release is found among those listed, in whatever order, and compared with this one', async () => {
  const releases = [
    { tag_name: 'v0.1.0-preview.5', html_url: 'https://github.com/Sheekovic/Proteus-Browser/releases/tag/v0.1.0-preview.5', published_at: '2026-11-19T10:00:00Z' },
    { tag_name: 'v0.1.0-preview.10', html_url: 'https://github.com/Sheekovic/Proteus-Browser/releases/tag/v0.1.0-preview.10', published_at: '2026-12-01T10:00:00Z' },
    { tag_name: 'v0.1.0-preview.9', html_url: 'https://github.com/Sheekovic/Proteus-Browser/releases/tag/v0.1.0-preview.9' },
    { tag_name: 'v9.9.9', draft: true, html_url: 'https://github.com/Sheekovic/Proteus-Browser/releases/tag/v9.9.9' },
    { tag_name: 'nightly' },
    'not a release',
  ];
  const seen: string[] = [];
  const newer = await checkForUpdate('0.1.0-preview.5', answering(200, releases, seen));
  assert.deepEqual(seen, [RELEASES_URL], 'one request, to the list of releases');
  assert.deepEqual([newer.current, newer.latest, newer.newer], ['0.1.0-preview.5', '0.1.0-preview.10', true]);
  assert.equal(newer.page, 'https://github.com/Sheekovic/Proteus-Browser/releases/tag/v0.1.0-preview.10');
  assert.equal(newer.published, '2026-12-01T10:00:00Z');
  assert.match(newer.message, /0\.1\.0-preview\.10 is out; this is 0\.1\.0-preview\.5/);

  const same = await checkForUpdate('0.1.0-preview.10', answering(200, releases));
  assert.deepEqual([same.newer, same.message], [false, 'This is the newest version (0.1.0-preview.10).']);
  const ahead = await checkForUpdate('0.2.0', answering(200, releases));
  assert.equal(ahead.newer, false);
  const tree = await checkForUpdate(null, answering(200, releases));
  assert.deepEqual([tree.newer, tree.latest], [false, '0.1.0-preview.10']);
  assert.match(tree.message, /not a release folder/);
});

test('an answer that is no list of releases, or none at all, is said and nothing is claimed', async () => {
  const refused = await checkForUpdate('0.1.0', answering(404, { message: 'Not Found' }));
  assert.deepEqual([refused.latest, refused.newer], [null, false]);
  assert.match(refused.message, /could not be read: GitHub answered 404/);
  const empty = await checkForUpdate('0.1.0', answering(200, []));
  assert.equal(empty.message, 'No release was found.');
  const failing = await checkForUpdate('0.1.0', (async () => { throw new Error('no network'); }) as typeof fetch);
  assert.match(failing.message, /could not be read: no network/);
  // A page that is not on GitHub is not handed on.
  const odd = await checkForUpdate('0.1.0', answering(200, [{ tag_name: 'v0.2.0', html_url: 'https://example.com/get' }]));
  assert.deepEqual([odd.newer, odd.page], [true, 'https://github.com/Sheekovic/Proteus-Browser/releases']);
});

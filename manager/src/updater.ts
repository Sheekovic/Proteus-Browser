// Getting a newer Proteus and putting it in the place of this one.
//
// update.ts says whether a release on GitHub is newer and where its file for this
// system is. Here that file is fetched, checked and made ready, and then put in:
//
//   1. the file is downloaded into the data folder, and its SHA-256 compared with the
//      one the release lists (SHA256SUMS.txt): a file that arrived damaged, or is not
//      the one the release names, is thrown away;
//   2. it is unpacked beside it and looked at: it must be a Proteus folder of the
//      version asked for;
//   3. on "apply", a small script is started on its own, the manager ends, and the
//      script - once nothing of this Proteus runs any more - copies the new kernel,
//      manager and Node.js over the old ones and starts Proteus again.
//
// A program cannot replace its own files while it runs (Windows refuses), which is
// why the last step is a script that outlives the manager. Profiles and settings are
// in the data folder and are not touched. Only a release folder can be updated: a
// working tree has no version to compare and is the developer's to change.
//
// The checksum shows the file is the one the release holds. Who made the release is
// shown by the signature on the list of checksums (releaseKey.ts): a Proteus that
// knows a release key takes only a release that key signed.

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createWriteStream, existsSync, readFileSync } from 'node:fs';
import { access, constants, mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';

import { RELEASE_KEYS, signedBy } from './releaseKey.ts';
import { type UpdateReport, bundleVersion, checkForUpdate, compareVersions, RELEASES_URL, DOWNLOAD_PREFIX } from './update.ts';

export type UpdateState = 'idle' | 'downloading' | 'checking' | 'unpacking' | 'ready' | 'failed';

export interface UpdateStatus {
  /** What the last look at the releases found, or null before the first. */
  report: UpdateReport | null;
  /** Whether this Proteus can replace itself, and if not, why. */
  canUpdate: boolean;
  why: string;
  state: UpdateState;
  /** The version being fetched or made ready. */
  version: string | null;
  received: number;
  total: number;
  message: string;
}

export interface UpdaterOptions {
  /** The manager folder of this Proteus (its parent is the release folder). */
  managerDir: string;
  /** Where profiles and settings are; the download goes in `update` under it. */
  dataDir: string;
  platform?: NodeJS.Platform;
  fetcher?: typeof fetch;
  /** For tests: another list of releases, and where its files may come from. */
  releasesUrl?: string;
  downloadPrefix?: string;
  /** The keys a release must be signed with; those of releaseKey.ts unless given. */
  releaseKeys?: readonly string[];
}

/** The parts of a release folder that are replaced; what else is in it is left alone. */
const FOLDERS = ['kernel', 'manager', 'node', 'licenses', 'fonts'];

const execute = (program: string, args: string[], env: NodeJS.ProcessEnv = process.env): Promise<void> => new Promise((done, failed) => {
  const child = spawn(program, args, { stdio: 'ignore', windowsHide: true, env });
  child.once('error', failed);
  child.once('exit', (code) => code === 0 ? done() : failed(new Error(`${program} ended with ${code}`)));
});

export class Updater {
  readonly root: string;
  private readonly options: Required<Omit<UpdaterOptions, 'fetcher'>> & { fetcher: typeof fetch };
  private report: UpdateReport | null = null;
  private state: UpdateState = 'idle';
  private version: string | null = null;
  private received = 0;
  private total = 0;
  private message = '';
  private working: Promise<void> | null = null;

  constructor(options: UpdaterOptions) {
    this.options = {
      platform: process.platform, fetcher: fetch, releasesUrl: RELEASES_URL, downloadPrefix: DOWNLOAD_PREFIX, ...options,
    };
    this.root = resolve(options.managerDir, '..');
  }

  get current(): string | null { return bundleVersion(this.options.managerDir); }
  private get workDir(): string { return join(this.options.dataDir, 'update'); }
  private folderOf(version: string): string { return join(this.workDir, version); }

  /** Why this Proteus cannot replace itself, or '' when it can. */
  private obstacle(): string {
    if (this.current === null) return 'This is not a release folder, so it is not updated from here.';
    if (this.options.platform !== 'win32' && this.options.platform !== 'linux') return 'There is no release for this system.';
    // The data folder inside the program folder would be in the way of its own update.
    const inside = relative(this.root, resolve(this.options.dataDir));
    if (inside === '' || (!inside.startsWith('..') && !inside.includes(':'))) {
      return 'The data folder is inside the program folder; move it out (PROTEUS_HOME) to update from here.';
    }
    return '';
  }

  /** Asks GitHub which release is the newest. Remembered for status(). */
  async check(): Promise<UpdateReport> {
    this.report = await checkForUpdate(this.current, this.options.fetcher, this.options.platform,
        this.options.releasesUrl, this.options.downloadPrefix);
    // A version made ready by an earlier run is still ready.
    const latest = this.report.latest;
    if (this.state === 'idle' && this.report.newer && latest !== null && this.isReady(latest)) {
      this.state = 'ready';
      this.version = latest;
      this.message = `Version ${latest} is ready to be put in.`;
    }
    return this.report;
  }

  status(): UpdateStatus {
    const why = this.obstacle();
    return {
      report: this.report, canUpdate: why === '', why,
      state: this.state, version: this.version, received: this.received, total: this.total, message: this.message,
    };
  }

  private isReady(version: string): boolean {
    return existsSync(join(this.folderOf(version), 'ready'));
  }

  /**
   * Fetches the newest release and makes it ready. Returns at once; status() says how
   * far it is. Asking again while it works, or once it is ready, changes nothing.
   */
  async prepare(): Promise<UpdateStatus> {
    const why = this.obstacle();
    if (why !== '') throw new Error(why);
    if (this.working !== null || this.state === 'ready') return this.status();
    const report = this.report?.newer ? this.report : await this.check();
    if (this.state === 'ready') return this.status();
    if (!report.newer || report.latest === null) throw new Error(report.message || 'There is nothing newer.');
    if (report.download === null) throw new Error(`Version ${report.latest} has no file for this system.`);
    const { latest: version, download } = report;
    this.state = 'downloading';
    this.version = version;
    this.received = 0;
    this.total = download.size;
    this.message = `Downloading version ${version}.`;
    this.working = this.fetchAndUnpack(version, download)
        .then(() => {
          this.state = 'ready';
          this.message = `Version ${version} is ready to be put in.`;
        }, async (error: Error) => {
          this.state = 'failed';
          this.message = `The update could not be made ready: ${error.message}`;
          await rm(this.folderOf(version), { recursive: true, force: true }).catch(() => {});
        })
        .finally(() => { this.working = null; });
    return this.status();
  }

  /** For tests: the end of what prepare() started. */
  async settled(): Promise<void> { await this.working; }

  private async fetchAndUnpack(version: string, download: NonNullable<UpdateReport['download']>): Promise<void> {
    const { fetcher } = this.options;
    // Whatever earlier tries left is in the way and of no use.
    await rm(this.workDir, { recursive: true, force: true });
    const folder = this.folderOf(version);
    await mkdir(folder, { recursive: true });
    const archive = join(folder, download.name);

    const response = await fetcher(download.url, { headers: { 'User-Agent': 'Proteus' }, redirect: 'follow' });
    if (!response.ok || response.body === null) throw new Error(`the download answered ${response.status}`);
    const hash = createHash('sha256');
    const file = createWriteStream(archive);
    try {
      for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
        hash.update(chunk);
        this.received += chunk.length;
        if (!file.write(chunk)) await new Promise((drained) => file.once('drain', drained));
      }
    } finally {
      await new Promise((closed) => file.end(closed));
    }

    this.state = 'checking';
    this.message = 'Comparing the file with the checksum the release lists.';
    const sums = await fetcher(download.sums, { headers: { 'User-Agent': 'Proteus' }, redirect: 'follow', signal: AbortSignal.timeout(30_000) });
    if (!sums.ok) throw new Error(`the list of checksums answered ${sums.status}`);
    const listed = await sums.text();
    // Whose list it is. A Proteus that knows no key (none was ever published) goes by
    // the checksum alone.
    const keys = this.options.releaseKeys ?? RELEASE_KEYS;
    if (keys.length > 0) {
      if (download.signature === undefined) throw new Error('the release is not signed; it was thrown away');
      const signature = await fetcher(download.signature, { headers: { 'User-Agent': 'Proteus' }, redirect: 'follow', signal: AbortSignal.timeout(30_000) });
      if (!signature.ok) throw new Error(`the signature of the release answered ${signature.status}`);
      if (!signedBy(listed, await signature.text(), keys)) {
        throw new Error('the release is not signed with the key this Proteus knows; it was thrown away');
      }
    }
    const expected = listed.split(/\r?\n/)
        .map((line) => /^([0-9a-f]{64})\s+\*?(.+)$/i.exec(line.trim()))
        .find((match) => match !== null && match[2] === download.name)?.[1].toLowerCase();
    if (expected === undefined) throw new Error('the release lists no checksum for its file');
    const actual = hash.digest('hex');
    if (actual !== expected) throw new Error('the downloaded file does not have the checksum the release lists; it was thrown away');

    this.state = 'unpacking';
    this.message = 'Unpacking.';
    await this.unpack(archive, folder);
    await rm(archive, { force: true });
    const unpacked = join(folder, 'Proteus');
    const kernel = this.options.platform === 'win32' ? 'chrome.exe' : 'chrome';
    for (const needed of [join('manager', 'src', 'main.ts'), join('kernel', kernel), 'VERSION.txt']) {
      if (!existsSync(join(unpacked, needed))) throw new Error(`what was unpacked is not a Proteus folder (${needed} is missing)`);
    }
    if (bundleVersion(join(unpacked, 'manager')) !== version) throw new Error(`what was unpacked is not version ${version}`);
    await writeFile(join(folder, 'ready'), `${version}\n`);
  }

  private async unpack(archive: string, into: string): Promise<void> {
    if (this.options.platform !== 'win32') return execute('tar', ['-xJf', archive, '-C', into]);
    // Windows' own tar reads zip files; one from elsewhere on the PATH may not.
    const tar = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe');
    if (existsSync(tar)) return execute(tar, ['-xf', archive, '-C', into]);
    return execute('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command',
      'Expand-Archive -LiteralPath $env:PROTEUS_ARCHIVE -DestinationPath $env:PROTEUS_INTO -Force'],
        { ...process.env, PROTEUS_ARCHIVE: archive, PROTEUS_INTO: into });
  }

  /**
   * Starts the script that puts the ready version in once the process `pid` (this
   * manager) has ended, and starts Proteus again. The caller ends the manager.
   */
  async apply(pid: number = process.pid): Promise<string> {
    const why = this.obstacle();
    if (why !== '') throw new Error(why);
    if (this.state !== 'ready' || this.version === null) throw new Error('No update is ready.');
    const from = join(this.folderOf(this.version), 'Proteus');
    try {
      await access(this.root, constants.W_OK);
    } catch {
      throw new Error(`The program folder cannot be written to: ${this.root}`);
    }
    const windows = this.options.platform === 'win32';
    const script = join(this.workDir, windows ? 'apply.ps1' : 'apply.sh');
    const log = join(this.workDir, 'apply.log');
    await writeFile(script, windows ? APPLY_WINDOWS : APPLY_LINUX, { mode: 0o755 });
    // On its own: it has to outlive this process, which a child otherwise does not.
    if (windows) {
      // PowerShell does not run without a console, which a process started apart from
      // this one would lack. So a first one, a child, starts the script as a process of
      // its own with a hidden window; what the script needs to know is handed down.
      await execute('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command',
        "Start-Process -FilePath powershell.exe -WindowStyle Hidden -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File',('\"' + $env:PROTEUS_UPDATE_SCRIPT + '\"')"],
      { ...process.env, PROTEUS_UPDATE_SCRIPT: script, PROTEUS_UPDATE_WAIT: String(pid), PROTEUS_UPDATE_FROM: from, PROTEUS_UPDATE_TO: this.root, PROTEUS_UPDATE_LOG: log });
    } else {
      spawn('sh', [script, String(pid), from, this.root, log], { detached: true, stdio: 'ignore' }).unref();
    }
    this.message = `Version ${this.version} is being put in; Proteus starts again by itself.`;
    return this.message;
  }

  /** Removes what earlier updates left, once this Proteus is the version they made. */
  async tidy(): Promise<void> {
    const current = this.current;
    if (current === null) return;
    let names: string[];
    try { names = await readdir(this.workDir); } catch { return; }
    for (const name of names) {
      const stale = /^\d+\.\d+\.\d+/.test(name) && compareVersions(name, current) <= 0;
      if (stale || name === 'apply.ps1' || name === 'apply.sh') await rm(join(this.workDir, name), { recursive: true, force: true }).catch(() => {});
    }
  }

  /** What the last apply wrote, for whoever wonders why an update did not take. */
  lastLog(): string {
    try { return readFileSync(join(this.workDir, 'apply.log'), 'utf8'); } catch { return ''; }
  }
}

export const UPDATE_FOLDERS = FOLDERS;

// The scripts are written out when needed, so that they are not among the files they
// replace. Each copies folder by folder: what else someone keeps in the program folder
// stays, and so does the note an install left there (installed.txt).

const APPLY_WINDOWS = String.raw`param([int]$Wait = $env:PROTEUS_UPDATE_WAIT, [string]$From = $env:PROTEUS_UPDATE_FROM,
  [string]$To = $env:PROTEUS_UPDATE_TO, [string]$Log = $env:PROTEUS_UPDATE_LOG)
$ErrorActionPreference = 'Continue'
function Note([string]$text) { "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $text" | Add-Content -Path $Log -Encoding utf8 }
Set-Content -Path $Log -Value '' -Encoding utf8
Note "putting in $From over $To"
# The manager that asked for this ends by itself; then nothing of this Proteus may run.
for ($i = 0; $i -lt 120 -and (Get-Process -Id $Wait -ErrorAction SilentlyContinue); $i++) { Start-Sleep -Milliseconds 500 }
function Running {
  $mine = @((Join-Path $To 'kernel\chrome.exe'), (Join-Path $To 'node\node.exe'))
  [bool](Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.Path -and ($mine -contains $_.Path) })
}
for ($i = 0; $i -lt 60 -and (Running); $i++) { Start-Sleep -Milliseconds 500 }
$ok = $true
if (Running) {
  Note 'this Proteus still runs: nothing was changed'
  $ok = $false
} elseif (-not (Test-Path (Join-Path $From 'manager\src\main.ts'))) {
  Note 'the new version is not where it was left: nothing was changed'
  $ok = $false
} else {
  foreach ($folder in ${FOLDERS.map((name) => `'${name}'`).join(', ')}) {
    if (-not (Test-Path (Join-Path $From $folder))) { continue }
    robocopy (Join-Path $From $folder) (Join-Path $To $folder) /MIR /R:3 /W:1 /NFL /NDL /NJH /NJS /NP | Out-Null
    if ($LASTEXITCODE -ge 8) { Note "copying $folder failed (robocopy $LASTEXITCODE)"; $ok = $false }
  }
  Get-ChildItem -LiteralPath $From -File | ForEach-Object {
    try { Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $To $_.Name) -Force } catch { Note "copying $($_.Name) failed: $_"; $ok = $false }
  }
  if ($ok) {
    $version = (Get-Content (Join-Path $To 'VERSION.txt') -TotalCount 1).Trim()
    Note "done: this is now $version"
    # The list of installed apps names the version, when this Proteus was installed.
    $registry = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\Proteus'
    $entry = Get-ItemProperty -Path $registry -ErrorAction SilentlyContinue
    if ($entry -and $entry.InstallLocation -eq $To) { Set-ItemProperty -Path $registry -Name DisplayVersion -Value $version }
    Remove-Item -LiteralPath (Split-Path $From) -Recurse -Force -ErrorAction SilentlyContinue
  }
}
$start = Join-Path $To 'Start Proteus.cmd'
if (Test-Path $start) { Start-Process -FilePath $start -WorkingDirectory $To -WindowStyle Minimized }
`;

const APPLY_LINUX = String.raw`#!/bin/sh
# usage: apply.sh <pid to wait for> <new Proteus folder> <program folder> <log>
wait_for=$1; from=$2; to=$3; log=$4
note() { echo "$(date '+%Y-%m-%d %H:%M:%S') $1" >> "$log"; }
: > "$log"
note "putting in $from over $to"
i=0
while kill -0 "$wait_for" 2>/dev/null && [ $i -lt 120 ]; do sleep 0.5; i=$((i + 1)); done
ok=1
if [ ! -f "$from/manager/src/main.ts" ]; then
  note 'the new version is not where it was left: nothing was changed'
  ok=0
else
  for folder in ${FOLDERS.join(' ')}; do
    [ -d "$from/$folder" ] || continue
    # The new one is put beside the old and takes its name, so that a copy that fails
    # half way leaves the old one whole.
    rm -rf "$to/$folder.new"
    if cp -a "$from/$folder" "$to/$folder.new" && rm -rf "$to/$folder" && mv "$to/$folder.new" "$to/$folder"; then :; else
      note "copying $folder failed"; ok=0
    fi
  done
  for file in "$from"/*; do
    [ -f "$file" ] || continue
    cp -a "$file" "$to/" || { note "copying $file failed"; ok=0; }
  done
  if [ $ok -eq 1 ]; then
    note "done: this is now $(head -n 1 "$to/VERSION.txt")"
    rm -rf "$(dirname "$from")"
  fi
fi
if [ -x "$to/start-proteus.sh" ]; then
  (setsid nohup "$to/start-proteus.sh" >/dev/null 2>&1 < /dev/null &)
fi
`;

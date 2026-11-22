// Runs fresh profiles past the public detection sites and says whether each verdict
// is still what it should be. Meant to be run now and then (after a kernel change,
// before a release, or on a schedule), so that a regression — ours, or a site getting
// stricter — is noticed instead of discovered by a user.
//
// usage: node site-check.mjs <kernel executable> [system ...]     (default: windows android ios)
//
// The sites are third parties: they change, time out and occasionally block. A row
// marked "no verdict" means the site gave nothing to judge, which is not a failure of
// the browser; the run fails only on a verdict that is worse than expected.
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const [kernel, ...asked] = process.argv.slice(2);
if (!kernel) {
  console.error('usage: site-check.mjs <kernel executable> [system ...]');
  process.exit(2);
}
const systems = asked.length ? asked : ['windows', 'android', 'ios'];
const here = dirname(fileURLToPath(import.meta.url));

/** What each site should say. Returns 'ok', 'bad' or 'none' (nothing to judge). */
const EXPECT = {
  sannysoft: (text, os) => {
    const failed = /failed=(\d+)(?: \[([^\]]*)\])?/.exec(text);
    if (!failed) return 'none';
    const names = (failed[2] || '').split('; ').filter(Boolean);
    // The table is written for desktop Chrome. A phone has no plugins or desktop
    // languages list, and Safari has no window.chrome: those rows are not tells there.
    // Nor is "Permissions" for Safari: that row compares Notification.permission with
    // the permission query, and Safari on an iPhone was read to have no Notification
    // in a page (only a site added to the Home Screen gets one), so the row fails on
    // the phone itself.
    const allowed = os === 'ios' ? ['Chrome', 'Permissions'] : os === 'android' ? ['Plugins Length', 'Plugins is of type PluginArray', 'Chrome'] : [];
    return names.every((name) => allowed.some((a) => name.includes(a))) ? 'ok' : 'bad';
  },
  browserscan: (text) => {
    const percent = /(\d{1,3})%/.exec(text);
    return !percent ? 'none' : Number(percent[1]) >= 95 ? 'ok' : 'bad';
  },
  // Its findings are the phrases before the page's own questions and answers; "No
  // masking detected" is the good one, so each phrase is read from its first word.
  pixelscan: (text) => {
    const findings = text.split(' | ').map((phrase) => phrase.trim());
    if (findings.some((f) => /^(Masking detected|Automated behavior detected|Your Browser Fingerprint is inconsistent)/i.test(f))) return 'bad';
    // Still "scanning…" when the page was read: nothing to judge yet.
    return findings.some((f) => /^Your Browser Fingerprint is consistent/i.test(f)) ? 'ok' : 'none';
  },
  iphey: (text) => /Trustworthy/i.test(text) ? 'ok' : /Unreliable|Suspicious|Not reliable/i.test(text) ? 'bad' : 'none',
  areyouabot: (text) => /You are human/i.test(text) ? 'ok' : /You are a bot/i.test(text) ? 'bad' : 'none',
  // Shows a similarity to headless browsers that an unmodified browser also gets; reported, not judged.
  creepjs: () => 'info',
};

let worst = 0;
for (const os of systems) {
  console.log(`\n== ${os}`);
  const run = spawnSync(process.execPath, [join(here, 'probe-profile.mjs'), kernel, 'sites', os, 'all'],
                        { encoding: 'utf8', timeout: 20 * 60_000 });
  const lines = (run.stdout || '').split('\n');
  for (const [site, judge] of Object.entries(EXPECT)) {
    const line = lines.find((l) => l.startsWith(site + ':'));
    const text = line ? line.slice(site.length + 1).trim() : '';
    const verdict = text === '' ? 'none' : judge(text, os);
    if (verdict === 'bad') worst = 1;
    const label = { ok: 'ok        ', bad: 'WORSE     ', none: 'no verdict', info: 'info      ' }[verdict];
    console.log(`${label} ${site.padEnd(12)} ${text.slice(0, 150)}`);
  }
}
console.log(worst ? '\nSITE-CHECK-FAIL' : '\nSITE-CHECK-OK');
process.exit(worst);

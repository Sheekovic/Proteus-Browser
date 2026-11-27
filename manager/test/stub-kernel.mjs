// A stand-in for the Proteus kernel, used by the tests. It behaves like the real one
// as far as the launcher can tell: it records how it was started, announces a
// DevTools port in <user data dir>/DevToolsActivePort and then keeps running.
// With --stub-exit-now it exits immediately instead, like a kernel that crashes.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const args = process.argv.slice(2);
const value = (name) => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const userDataDir = value('user-data-dir');

writeFileSync(join(userDataDir, 'stub-args.json'), JSON.stringify(args));
if (args.includes('--stub-exit-now')) process.exit(7);

writeFileSync(join(userDataDir, 'DevToolsActivePort'), '45678\n/devtools/browser/stub\n');

// With --stub-moves it takes a new place as the real kernel does (patch 0043): what
// appears in place.json beside its configuration is acknowledged in place.taken.
if (args.includes('--stub-moves')) {
  const folder = dirname(value('proteus-config'));
  let seen = '';
  setInterval(() => {
    let text = '';
    try { text = readFileSync(join(folder, 'place.json'), 'utf8'); } catch { return; }
    if (text === seen) return;
    seen = text;
    writeFileSync(join(folder, 'place.taken'), JSON.parse(text).id);
  }, 20);
}
setInterval(() => {}, 1000);

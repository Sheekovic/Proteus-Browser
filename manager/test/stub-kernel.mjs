// A stand-in for the Proteus kernel, used by the tests. It behaves like the real one
// as far as the launcher can tell: it records how it was started, announces a
// DevTools port in <user data dir>/DevToolsActivePort and then keeps running.
// With --stub-exit-now it exits immediately instead, like a kernel that crashes.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const value = (name) => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const userDataDir = value('user-data-dir');

writeFileSync(join(userDataDir, 'stub-args.json'), JSON.stringify(args));
if (args.includes('--stub-exit-now')) process.exit(7);

writeFileSync(join(userDataDir, 'DevToolsActivePort'), '45678\n/devtools/browser/stub\n');
setInterval(() => {}, 1000);

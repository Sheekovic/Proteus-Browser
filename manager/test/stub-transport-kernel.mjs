// A stand-in for the kernel when its handshake is measured (launcher.transport): it
// records how it was started and requests the address it was given over HTTP/2, with
// Node's own TLS and HTTP/2 shape and the User-Agent of the configuration it got.
// With --stub-exit-now it exits at once instead, like a kernel that cannot start.
import { readFileSync, writeFileSync } from 'node:fs';
import { connect } from 'node:http2';
import { join } from 'node:path';

const args = process.argv.slice(2);
const value = (name) => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
writeFileSync(join(value('user-data-dir'), '..', 'stub-args.json'), JSON.stringify(args));
if (process.env.PROTEUS_STUB_ARGS_COPY) writeFileSync(process.env.PROTEUS_STUB_ARGS_COPY, JSON.stringify(args));
if (args.includes('--stub-exit-now')) process.exit(7);

const config = JSON.parse(readFileSync(value('proteus-config'), 'utf8'));
const session = connect(args[args.length - 1], { rejectUnauthorized: false });
session.on('error', () => {});
const request = session.request({ ':path': '/', 'user-agent': config.userAgent });
request.on('error', () => {});
request.resume();
setInterval(() => {}, 1000);

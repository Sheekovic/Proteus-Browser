// Shows which hosts a starting kernel tries to reach on its own, before the user
// opens anything. The kernel is pointed at a proxy that refuses everything and writes
// down what it was asked for, once with the manager's launch arguments and once with
// a bare command line.
//
// usage: node startup-traffic.mjs <kernel executable> [seconds=20] [extra kernel args...]
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import { generateIdentity } from '../../src/fingerprint.ts';
import { buildKernelArgs, buildKernelConfig } from '../../src/kernelConfig.ts';

const [kernelPath, secondsArg, ...extraArgs] = process.argv.slice(2);
const seconds = Number(secondsArg) || 20;

async function observe(label, makeArgs) {
  const asked = new Map();
  const proxy = createServer((socket) => {
    socket.on('error', () => {});
    socket.once('data', (data) => {
      const [method, target] = data.toString('latin1').split(' ');
      const host = method === 'CONNECT' ? target : (() => { try { return new URL(target).host; } catch { return target; } })();
      asked.set(host, (asked.get(host) ?? 0) + 1);
      socket.end('HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\n\r\n');
    });
  });
  await new Promise((resolve) => proxy.listen(0, '127.0.0.1', resolve));
  const dir = mkdtempSync(join(tmpdir(), 'proteus-traffic-'));
  const child = spawn(kernelPath, makeArgs(dir, `http://127.0.0.1:${proxy.address().port}`), { stdio: 'ignore' });
  await delay(seconds * 1000);
  child.kill();
  await delay(1500);
  proxy.close();
  rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
  console.log(`${label}: ${asked.size} host(s) contacted in ${seconds}s`);
  for (const [host, count] of [...asked].sort()) console.log(`  ${host}  x${count}`);
  return asked.size;
}

await observe('bare command line', (dir, proxyUrl) =>
  [`--user-data-dir=${dir}`, `--proxy-server=${proxyUrl}`, '--no-first-run', ...extraArgs]);

const identity = generateIdentity('windows', '157.0.8103.79');
const profile = {
  ...identity, id: 'x', name: 'x', notes: '', createdAt: '', updatedAt: '', languages: [], timezone: '',
  webrtc: 'proxyOnly', webrtcPublicIp: '', geolocation: null, proxy: null, matchProxy: false, startUrl: '',
};
const quiet = await observe('manager launch arguments', (dir, proxyUrl) => {
  const configFile = join(dir, 'kernel.json');
  writeFileSync(configFile, JSON.stringify(buildKernelConfig(profile)));
  return buildKernelArgs(profile, { userDataDir: join(dir, 'browser'), configFile, proxyServer: proxyUrl }, extraArgs);
});
process.exit(quiet === 0 ? 0 : 1);

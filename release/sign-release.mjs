// Signs a release's list of checksums, so that an update shows who made the release and
// not only that it arrived whole (manager/src/releaseKey.ts).
//
//   node sign-release.mjs --new-key [key file]         makes the key, once
//   node sign-release.mjs <SHA256SUMS.txt> [key file]  writes <SHA256SUMS.txt>.sig
//   node sign-release.mjs --public [key file]          prints the public half again
//
// The key file holds the private half: whoever has it can sign a release every Proteus
// will take. It stays on the maker's machine, outside the repository (by default in
// the user's own folder, .proteus-release/release-key.pem), and is never uploaded.
// Its public half goes into RELEASE_KEYS in manager/src/releaseKey.ts.

import { createPrivateKey, createPublicKey, generateKeyPairSync, sign } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

const args = process.argv.slice(2);
const flag = args[0]?.startsWith('--') ? args.shift() : undefined;
const DEFAULT_KEY = join(homedir(), '.proteus-release', 'release-key.pem');

/** The public half as the manager lists it: the base64 of its 32 bytes. */
function publicText(privateKey) {
  const der = createPublicKey(privateKey).export({ format: 'der', type: 'spki' });
  return der.subarray(der.length - 32).toString('base64');
}

if (flag === '--new-key') {
  const keyFile = args[0] ?? DEFAULT_KEY;
  if (existsSync(keyFile)) {
    console.error(`${keyFile} is already there. A new key would make every Proteus refuse the next release; remove the file yourself if that is what you want.`);
    process.exit(1);
  }
  const { privateKey } = generateKeyPairSync('ed25519');
  mkdirSync(dirname(keyFile), { recursive: true });
  writeFileSync(keyFile, privateKey.export({ format: 'pem', type: 'pkcs8' }), { mode: 0o600 });
  try { chmodSync(keyFile, 0o600); } catch { /* Windows keeps its own permissions. */ }
  console.log(`The key is in ${keyFile}. Keep a copy somewhere safe: without it no release can be signed.`);
  console.log(`Its public half, for RELEASE_KEYS in manager/src/releaseKey.ts:\n${publicText(privateKey)}`);
} else if (flag === '--public') {
  console.log(publicText(createPrivateKey(readFileSync(args[0] ?? DEFAULT_KEY))));
} else if (flag === undefined && args[0]) {
  const [sumsFile, keyFile = DEFAULT_KEY] = args;
  if (!existsSync(keyFile)) {
    console.error(`There is no key in ${keyFile}. Make one with: node sign-release.mjs --new-key`);
    process.exit(1);
  }
  const privateKey = createPrivateKey(readFileSync(keyFile));
  // The list as the release holds it, byte for byte: that is what an updater reads.
  const signature = sign(null, readFileSync(sumsFile), privateKey).toString('base64');
  writeFileSync(`${sumsFile}.sig`, signature + '\n');
  console.log(`${sumsFile}.sig written (key ${publicText(privateKey)}).`);
} else {
  console.error('usage: sign-release.mjs --new-key [key file] | <SHA256SUMS.txt> [key file] | --public [key file]');
  process.exit(2);
}

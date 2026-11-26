// Who made a release: the signature on its list of checksums.
//
// A release holds its files, SHA256SUMS.txt with a checksum for each, and, when it was
// signed, SHA256SUMS.txt.sig: an Ed25519 signature of that list, made with a key only
// the maker of the releases has (release/sign-release.mjs). The checksum shows a file
// is the one the release lists; the signature shows the list is the maker's, so a
// release put up by someone else under the same name is not taken.
//
// The public halves of the keys releases are signed with are below. A Proteus that
// knows a key takes an update only with a signature one of them made. While the list
// is empty (no release has been signed yet) an update is checked by its checksum
// alone, as before, and the window says so.

import { createPublicKey, verify } from 'node:crypto';

/**
 * Public keys releases may be signed with: Ed25519, each as the base64 of its 32
 * bytes (what sign-release.mjs prints). More than one, so that a key can be replaced:
 * a release signed with the new one still updates a Proteus that knows only the old
 * one if it is signed with both... which it is not, so a replaced key is added here
 * one release before the old one is dropped.
 */
export const RELEASE_KEYS: readonly string[] = [];

/** The DER wrapping of a raw Ed25519 public key (RFC 8410), in front of its 32 bytes. */
const ED25519_SPKI = Buffer.from('302a300506032b6570032100', 'hex');

/** Whether `signature` (base64) is one of `keys`' signature of `text`. */
export function signedBy(text: string, signature: string, keys: readonly string[]): boolean {
  let made: Buffer;
  try {
    made = Buffer.from(signature.trim(), 'base64');
  } catch {
    return false;
  }
  if (made.length !== 64) return false;
  for (const key of keys) {
    try {
      const raw = Buffer.from(key, 'base64');
      if (raw.length !== 32) continue;
      const publicKey = createPublicKey({ key: Buffer.concat([ED25519_SPKI, raw]), format: 'der', type: 'spki' });
      if (verify(null, Buffer.from(text, 'utf8'), publicKey, made)) return true;
    } catch {
      // Not a key: the next one.
    }
  }
  return false;
}

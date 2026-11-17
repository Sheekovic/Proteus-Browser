// Lists a profile leaves to the machine it runs on, and saving them with the profile.
//
// A new profile has no language list of its own: the kernel then reports the
// languages of the computer it runs on, at every start. Profiles saved by early
// versions have no voice list either. The same profile would thus look different on
// another computer. So the first time such a profile runs, the manager asks its
// browser what it reported and saves that in the profile: nothing changes on this
// computer, and from then on the profile carries the lists itself.
//
// What cannot be kept this way is documented where it arises: the stand-in fonts of
// fontSubstitutes.ts must be fonts of the machine the kernel runs on, and a profile
// without `webglCaps` reports the real graphics card's limits.

import type { Profile, ProfileInput, Voice } from './profile.ts';

export type BorrowedList = 'languages' | 'voices';

/** The lists `profile` takes from the machine at each start and a browser can be asked for. */
export function borrowedLists(profile: Profile): BorrowedList[] {
  const borrowed: BorrowedList[] = [];
  if (profile.languages.length === 0) borrowed.push('languages');
  if (profile.voices.length === 0) borrowed.push('voices');
  return borrowed;
}

/**
 * The script the browser is asked with. It is run in a JavaScript world of its own
 * (browserControl.ts), so a page can neither see it nor change what it reads.
 */
export const READ_LISTS_SCRIPT = `(async () => {
  const voices = await new Promise((resolve) => {
    if (!('speechSynthesis' in globalThis)) return resolve([]);
    const list = () => speechSynthesis.getVoices().map((v) =>
        ({ name: String(v.name), lang: String(v.lang), local: Boolean(v.localService), default: Boolean(v.default) }));
    const now = list();
    if (now.length > 0) return resolve(now);
    const done = () => resolve(list());
    speechSynthesis.addEventListener('voiceschanged', done, { once: true });
    setTimeout(done, 2000);
  });
  return JSON.stringify({ languages: Array.from(navigator.languages || []), voices });
})()`;

const MAX_LANGUAGES = 20;
/** Bytes of kernel configuration the voice list may take, as for a device reading (collected.ts). */
const VOICE_BUDGET = 3000;

function cleanLanguages(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const languages = value.filter((tag): tag is string =>
      typeof tag === 'string' && /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(tag));
  return [...new Set(languages)].slice(0, MAX_LANGUAGES);
}

function cleanVoices(value: unknown): Voice[] {
  if (!Array.isArray(value)) return [];
  const voices: Voice[] = [];
  let spent = 0;
  for (const raw of value as Record<string, unknown>[]) {
    if (typeof raw !== 'object' || raw === null || typeof raw.name !== 'string' || raw.name.trim() === '' ||
        raw.name.length > 200 || typeof raw.lang !== 'string' || raw.lang.length > 35) {
      continue;
    }
    const voice: Voice = { name: raw.name, lang: raw.lang, local: raw.local === true, default: raw.default === true };
    spent += Buffer.byteLength(JSON.stringify(voice)) + 1;
    if (spent > VOICE_BUDGET) break;
    voices.push(voice);
  }
  return voices;
}

/**
 * The fields to save in `profile` so that it no longer borrows what `read` holds:
 * what its browser reported, checked. Only lists the profile still leaves empty are
 * touched; a list the browser reported empty stays borrowed.
 */
export function listsToKeep(profile: Profile, read: unknown): ProfileInput {
  const keep: ProfileInput = {};
  if (typeof read !== 'object' || read === null) return keep;
  const { languages, voices } = read as Record<string, unknown>;
  const borrowed = borrowedLists(profile);
  if (borrowed.includes('languages') && cleanLanguages(languages).length > 0) keep.languages = cleanLanguages(languages);
  if (borrowed.includes('voices') && cleanVoices(voices).length > 0) keep.voices = cleanVoices(voices);
  return keep;
}

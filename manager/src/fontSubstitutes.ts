// Chooses stand-in fonts for the fonts a profile claims.
//
// A profile may claim fonts the machine lacks (a macOS profile on Windows claims
// Helvetica Neue). The kernel serves such a font with the first installed entry of
// its substitute list, and ignores the list when the real font is installed. So the
// lists here can be the same on every machine: they simply name commonly installed
// fonts of the same kind from Windows, macOS and Linux.

type FontKind = 'sans' | 'serif' | 'mono';

// Commonly installed fonts of each kind, across the three desktop systems.
const POOLS: Record<FontKind, readonly string[]> = {
  sans: [
    'Arial', 'Verdana', 'Tahoma', 'Trebuchet MS', 'Segoe UI', 'Calibri',
    'Helvetica', 'Helvetica Neue', 'Geneva', 'Lucida Grande',
    'DejaVu Sans', 'Liberation Sans', 'Nimbus Sans', 'Noto Sans', 'Ubuntu',
  ],
  serif: [
    'Times New Roman', 'Georgia', 'Cambria', 'Palatino Linotype',
    'Times', 'Palatino', 'Baskerville',
    'DejaVu Serif', 'Liberation Serif', 'Nimbus Roman', 'Noto Serif',
  ],
  mono: [
    'Consolas', 'Courier New', 'Lucida Console',
    'Menlo', 'Monaco', 'Courier',
    'DejaVu Sans Mono', 'Liberation Mono', 'Nimbus Mono PS', 'Noto Sans Mono', 'Ubuntu Mono',
  ],
};

const MONO_HINTS = ['mono', 'consolas', 'courier', 'menlo', 'monaco', 'console', 'typewriter', 'ms gothic'];
const SERIF_HINTS = [
  'serif', 'times', 'georgia', 'cambria', 'constantia', 'palatino', 'baskerville', 'didot', 'bodoni',
  'garamond', 'caslon', 'cochin', 'charter', 'hoefler', 'rockwell', 'sitka', 'sylfaen', 'roman',
  'bookman', 'simsun', 'mingliu', 'c059', 'p052',
];

/** Guesses a font's kind from its name; unknown names count as sans-serif. */
export function kindOf(font: string): FontKind {
  const name = font.toLowerCase();
  // "DejaVu Sans Mono" is monospace, so this test comes before the "sans" one.
  if (MONO_HINTS.some((hint) => name.includes(hint))) return 'mono';
  // "Microsoft Sans Serif" is sans-serif, so "sans" comes before the serif hints.
  if (name.includes('sans')) return 'sans';
  if (SERIF_HINTS.some((hint) => name.includes(hint))) return 'serif';
  return 'sans';
}

/** Small stable string hash, so a font always gets the same substitutes. */
function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

/**
 * Substitute lists for `fonts`, keyed by font. Each list is the pool for that font's
 * kind, rotated by a hash of the font's name. Rotation spreads claimed fonts over
 * different stand-ins instead of making them all render as the same one.
 */
export function buildFontSubstitutes(fonts: readonly string[]): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  for (const font of fonts) {
    const pool = POOLS[kindOf(font)].filter((candidate) => candidate.toLowerCase() !== font.toLowerCase());
    const start = hash(font.toLowerCase()) % pool.length;
    result[font] = [...pool.slice(start), ...pool.slice(0, start)];
  }
  return result;
}

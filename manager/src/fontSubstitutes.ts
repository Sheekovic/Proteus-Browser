// Chooses stand-in fonts for the fonts a profile claims.
//
// A profile may claim fonts the machine lacks (a macOS profile on Windows claims
// Helvetica Neue). The kernel serves such a font with the first installed entry of
// its substitute list, and ignores the list when the real font is installed. The
// stand-ins are fonts every installation of the machine's own system has.

type FontKind = 'sans' | 'serif' | 'mono';
type HostSystem = 'windows' | 'macos' | 'linux';

// Fonts of each kind that ship with each desktop system.
const POOLS: Record<HostSystem, Record<FontKind, readonly string[]>> = {
  windows: {
    sans: ['Arial', 'Verdana', 'Tahoma', 'Trebuchet MS', 'Segoe UI', 'Calibri'],
    serif: ['Times New Roman', 'Georgia', 'Cambria', 'Palatino Linotype'],
    mono: ['Consolas', 'Courier New', 'Lucida Console'],
  },
  macos: {
    sans: ['Helvetica', 'Helvetica Neue', 'Geneva', 'Lucida Grande', 'Arial', 'Verdana'],
    serif: ['Times', 'Palatino', 'Baskerville', 'Times New Roman', 'Georgia'],
    mono: ['Menlo', 'Monaco', 'Courier', 'Courier New'],
  },
  linux: {
    sans: ['DejaVu Sans', 'Liberation Sans', 'Nimbus Sans', 'Noto Sans', 'Ubuntu'],
    serif: ['DejaVu Serif', 'Liberation Serif', 'Nimbus Roman', 'Noto Serif'],
    mono: ['DejaVu Sans Mono', 'Liberation Mono', 'Nimbus Mono PS', 'Noto Sans Mono', 'Ubuntu Mono'],
  },
};

function hostSystem(): HostSystem {
  return process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'macos' : 'linux';
}

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
 * Largest number of stand-ins per font. The lists travel to every kernel process on
 * its command line (see MAX_PACKED_CONFIG in kernelConfig.ts), so they are kept short.
 */
const MAX_SUBSTITUTES = 3;

/**
 * Substitute lists for `fonts`, keyed by font: fonts of the same kind that the
 * machine running the kernel (`host`) has, starting at a point picked by a hash of
 * the font's name. That spreads claimed fonts over different stand-ins instead of
 * making them all render as the same one.
 */
export function buildFontSubstitutes(fonts: readonly string[],
                                     host: HostSystem = hostSystem()): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  for (const font of fonts) {
    const pool = POOLS[host][kindOf(font)].filter((candidate) => candidate.toLowerCase() !== font.toLowerCase());
    const start = hash(font.toLowerCase()) % pool.length;
    result[font] = [...pool.slice(start), ...pool.slice(0, start)].slice(0, MAX_SUBSTITUTES);
  }
  return result;
}

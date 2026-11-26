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
 * The font families that come with Proteus, in the `fonts` folder of a release
 * (release/fonts.txt lists the files). Android's own fonts, which may be passed on,
 * and fonts made to have the measures of ones that may not: text set in Arimo breaks
 * its lines where Arial does.
 */
export const SHIPPED_FONTS: readonly string[] = [
  'Roboto', 'Noto Sans', 'Noto Serif', 'Noto Color Emoji', 'Noto Sans JP', 'Droid Sans Mono', 'Cutive Mono',
  'Coming Soon', 'Dancing Script', 'Carrois Gothic SC',
  'Arimo', 'Tinos', 'Cousine', 'Carlito', 'Caladea', 'Gelasio',
];

/** The shipped font with the measures of a font that cannot be shipped. */
const SAME_MEASURES: Record<string, string> = {
  arial: 'Arimo', helvetica: 'Arimo', 'times new roman': 'Tinos', times: 'Tinos',
  'courier new': 'Cousine', courier: 'Cousine', calibri: 'Carlito', cambria: 'Caladea', georgia: 'Gelasio',
};

/**
 * What Android itself draws a name with that it answers to without having the font:
 * its font configuration maps these onto its own faces.
 */
const ANDROID_ANSWERS: Record<string, string> = {
  arial: 'Roboto', helvetica: 'Roboto', tahoma: 'Roboto', verdana: 'Roboto',
  baskerville: 'Noto Serif', georgia: 'Noto Serif', goudy: 'Noto Serif', palatino: 'Noto Serif',
  times: 'Noto Serif', 'times new roman': 'Noto Serif',
  courier: 'Cutive Mono', 'courier new': 'Cutive Mono', monaco: 'Droid Sans Mono',
  'noto sans cjk jp': 'Noto Sans JP',
};

/** Shipped fonts of each kind, for a claimed font that has no counterpart. */
const SHIPPED_POOL: Record<FontKind, readonly string[]> = {
  sans: ['Arimo', 'Noto Sans', 'Roboto', 'Carlito'],
  serif: ['Tinos', 'Noto Serif', 'Caladea', 'Gelasio'],
  mono: ['Cousine', 'Droid Sans Mono', 'Cutive Mono'],
};

/**
 * For an Android profile with the shipped fonts: which of `fonts` Android answers to
 * with a face of its own, and with which. The kernel draws the name with that face
 * whatever the machine has by that name.
 */
export function androidAnswers(fonts: readonly string[]): Record<string, string> {
  const answers: Record<string, string> = {};
  for (const font of fonts) {
    const face = ANDROID_ANSWERS[font.toLowerCase()];
    if (face !== undefined) answers[font] = face;
  }
  return answers;
}

export interface SubstituteOptions {
  /** The system the kernel runs on. */
  host?: HostSystem;
  /**
   * The system the profile claims, when the fonts that come with Proteus are there
   * (the kernel is given their folder). Stand-ins are then those fonts, the same on
   * every machine; without it they are fonts of the machine.
   */
  shippedFor?: string;
}

/**
 * Substitute lists for `fonts`, keyed by font. With the shipped fonts: the font
 * Android draws the name with (for an Android profile), else the shipped font with
 * the same measures, else shipped fonts of the same kind. Without them: fonts of the
 * same kind that the machine running the kernel has. Either way the list starts at a
 * point picked by a hash of the font's name, which spreads claimed fonts over
 * different stand-ins instead of making them all render as the same one.
 */
export function buildFontSubstitutes(fonts: readonly string[],
                                     options: SubstituteOptions | HostSystem = {}): Record<string, string[]> {
  const { host = hostSystem(), shippedFor } = typeof options === 'string' ? { host: options } : options;
  const result: Record<string, string[]> = {};
  for (const font of fonts) {
    const name = font.toLowerCase();
    const spread = (pools: Record<FontKind, readonly string[]>): string[] => {
      const pool = pools[kindOf(font)].filter((candidate) => candidate.toLowerCase() !== name);
      const start = hash(name) % pool.length;
      return [...pool.slice(start), ...pool.slice(0, start)];
    };
    const own = spread(POOLS[host]);
    if (shippedFor === undefined) {
      result[font] = own.slice(0, MAX_SUBSTITUTES);
      continue;
    }
    const first = (shippedFor === 'android' ? ANDROID_ANSWERS[name] : undefined) ?? SAME_MEASURES[name];
    const shipped = [...new Set(first !== undefined ? [first, ...spread(SHIPPED_POOL)] : spread(SHIPPED_POOL))];
    // The last one is the machine's: a kernel that does not know the folder still
    // finds the font, as it did before the fonts came along.
    result[font] = [...shipped.slice(0, MAX_SUBSTITUTES - 1), own[0]!];
  }
  return result;
}

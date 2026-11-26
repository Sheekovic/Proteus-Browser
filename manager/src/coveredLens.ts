// The picture of a camera whose lens is covered: what a laptop with its shutter closed
// sends, near black with the grain of a sensor in the dark.
//
// It is what a page gets from a profile whose devices are not this machine's, unless
// the profile names a video file or asks for the machine's camera: the room the
// machine stands in is the same in every profile on it, and nobody's to be shown
// without being asked for.

// The size a page gets from any camera when it asks for none in particular. The
// kernel makes the other sizes a camera offers from these frames (kernel patch 0036);
// an earlier kernel offers this one size, the right one for the most common question.
export const COVERED_WIDTH = 640;
export const COVERED_HEIGHT = 480;
const FRAMES = 12;
const FRAME_MARK = Buffer.from('FRAME\n', 'ascii');

/** A number from a seed's text, never zero. */
function start(seed: string): number {
  let state = 2166136261;
  for (let i = 0; i < seed.length; i++) state = Math.imul(state ^ seed.charCodeAt(i), 16777619);
  return (state >>> 0) || 1;
}

/**
 * The picture as a .y4m video, which the kernel plays in a loop. The grain is the
 * seed's own, so two profiles do not send the same frames.
 */
export function coveredLensVideo(seed: string): Buffer {
  const header = Buffer.from(`YUV4MPEG2 W${COVERED_WIDTH} H${COVERED_HEIGHT} F30:1 Ip A1:1 C420jpeg\n`, 'ascii');
  const luma = COVERED_WIDTH * COVERED_HEIGHT;
  const chroma = luma / 2;
  const frame = FRAME_MARK.length + luma + chroma;
  const video = Buffer.alloc(header.length + FRAMES * frame);
  header.copy(video, 0);
  let state = start(seed);
  let at = header.length;
  for (let n = 0; n < FRAMES; n++) {
    FRAME_MARK.copy(video, at);
    at += FRAME_MARK.length;
    // Brightness: just above black, most pixels within two steps of it and a few
    // further, as the product of two random numbers falls.
    for (const end = at + luma; at < end; at++) {
      state ^= state << 13; state >>>= 0; state ^= state >>> 17; state ^= state << 5; state >>>= 0;
      video[at] = 16 + (((state & 0xff) * ((state >>> 8) & 0xff)) >>> 13);
    }
    // Colour: none, but for a step either way here and there.
    for (const end = at + chroma; at < end; at++) {
      state ^= state << 13; state >>>= 0; state ^= state >>> 17; state ^= state << 5; state >>>= 0;
      const roll = state & 0x1f;
      video[at] = roll === 0 ? 127 : roll === 1 ? 129 : 128;
    }
  }
  return video;
}

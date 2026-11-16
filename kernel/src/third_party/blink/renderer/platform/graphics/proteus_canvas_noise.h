// Copyright 2026 The Proteus Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#ifndef THIRD_PARTY_BLINK_RENDERER_PLATFORM_GRAPHICS_PROTEUS_CANVAS_NOISE_H_
#define THIRD_PARTY_BLINK_RENDERER_PLATFORM_GRAPHICS_PROTEUS_CANVAS_NOISE_H_

#include <stdint.h>

#include "base/containers/span.h"
#include "base/memory/scoped_refptr.h"
#include "cc/paint/paint_image.h"
#include "third_party/blink/renderer/platform/platform_export.h"
#include "third_party/skia/include/core/SkPixmap.h"

namespace blink {

class StaticBitmapImage;

// Canvas readback noise.
//
// When the active Proteus profile enables canvas noise, pixels handed back to
// script are perturbed so that the canvas fingerprint is unique to the profile.
// The perturbation is a pure function of (profile seed, pixel position, pixel
// colour, left neighbour), which gives it these properties:
//   * reading the same canvas twice yields identical data;
//   * a full read and any sub-rectangle read agree on every shared pixel;
//   * flat areas are never touched - only pixels that differ from their left
//     neighbour (shape and glyph edges) can change, by one step in one channel;
//   * only fully opaque pixels change, so premultiplied and unpremultiplied
//     reads agree.

// Returns |image| with noise applied to a private copy of its pixels, or
// |image| itself when noise is disabled or the pixel format is unsupported.
// |device_dependent| says whether the canvas holds anything whose pixels vary
// between devices (text, curves, ...). A canvas that only holds pixels the page
// already knows exactly, such as putImageData() or plain rectangles, is left
// alone: there is no fingerprint in it, and changing it would be detectable.
PLATFORM_EXPORT scoped_refptr<StaticBitmapImage> ProteusNoisedCanvasImage(
    scoped_refptr<StaticBitmapImage> image,
    bool device_dependent = true);

// Reads the rectangle of |image| whose top-left corner is (sx, sy) and whose
// size is that of |dst| into |dst|, with noise applied. Returns false, leaving
// |dst| untouched, when noise is disabled or cannot be applied; the caller then
// performs its ordinary read.
PLATFORM_EXPORT bool ProteusReadNoisedCanvasPixels(const cc::PaintImage& image,
                                                   const SkPixmap& dst,
                                                   int sx,
                                                   int sy);

// True when the active profile asks for canvas readback noise.
PLATFORM_EXPORT bool ProteusCanvasNoiseEnabled();

// Finishes a WebGL readPixels() call. |scratch| holds |height| tightly packed
// rows of |width_with_context| 8-bit RGBA pixels, the first column being the
// pixel to the left of the area the caller asked for. Row r, column c is canvas
// position (origin_x + c, origin_y + r * y_step); WebGL rows run bottom-up, so
// callers pass y_step = -1. Noise is applied and every column but the first is
// copied to |dst|, which must hold (width_with_context - 1) * height pixels.
PLATFORM_EXPORT void ProteusNoiseAndCopyRgba(base::span<uint8_t> scratch,
                                             int width_with_context,
                                             int height,
                                             int64_t origin_x,
                                             int64_t origin_y,
                                             int y_step,
                                             uint8_t* dst);

}  // namespace blink

#endif  // THIRD_PARTY_BLINK_RENDERER_PLATFORM_GRAPHICS_PROTEUS_CANVAS_NOISE_H_

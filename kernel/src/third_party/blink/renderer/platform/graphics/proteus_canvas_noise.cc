// Copyright 2026 The Proteus Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#ifdef UNSAFE_BUFFERS_BUILD
// Pixel rows are walked with raw pointers obtained from Skia.
#pragma allow_unsafe_buffers
#endif

#include "third_party/blink/renderer/platform/graphics/proteus_canvas_noise.h"

#include <stdint.h>
#include <string.h>

#include <limits>

#include "base/check_op.h"
#include "base/proteus/proteus_config.h"
#include "third_party/blink/renderer/platform/graphics/static_bitmap_image.h"
#include "third_party/blink/renderer/platform/graphics/unaccelerated_static_bitmap_image.h"
#include "third_party/skia/include/core/SkBitmap.h"
#include "third_party/skia/include/core/SkColor.h"
#include "third_party/skia/include/core/SkImage.h"
#include "third_party/skia/include/core/SkImageInfo.h"

namespace blink {

namespace {

// One edge pixel in this many is perturbed.
constexpr uint64_t kEdgeSelectionRate = 8;

bool IsSupported(SkColorType color_type) {
  return color_type == kRGBA_8888_SkColorType ||
         color_type == kBGRA_8888_SkColorType;
}

uint64_t Mix(uint64_t seed, int64_t x, int64_t y, uint32_t rgb) {
  uint64_t h = seed;
  h ^= static_cast<uint64_t>(x) * 0x9E3779B97F4A7C15ull;
  h ^= static_cast<uint64_t>(y) * 0xC2B2AE3D27D4EB4Full;
  h ^= static_cast<uint64_t>(rgb) * 0x165667B19E3779F9ull;
  h ^= h >> 30;
  h *= 0xBF58476D1CE4E5B9ull;
  h ^= h >> 27;
  h *= 0x94D049BB133111EBull;
  h ^= h >> 31;
  return h;
}

// Perturbs |height| rows of |width| 4-byte pixels in place, the rows being
// |row_bytes| apart starting at |first_row|. Row r, column c is canvas position
// (origin_x + c, origin_y + r * y_step). Column 0 only ever serves as
// left-neighbour context and is never modified.
void ApplyNoiseRows(uint8_t* first_row,
                    size_t row_bytes,
                    int width,
                    int height,
                    bool is_bgra,
                    int64_t origin_x,
                    int64_t origin_y,
                    int y_step,
                    uint64_t seed) {
  // Byte offsets of the colour channels in canonical R, G, B order.
  const int channel_offset[3] = {is_bgra ? 2 : 0, 1, is_bgra ? 0 : 2};

  for (int y = 0; y < height; ++y) {
    uint8_t* row = first_row + row_bytes * static_cast<size_t>(y);
    const int64_t canvas_y = origin_y + static_cast<int64_t>(y) * y_step;
    uint8_t left[4];
    memcpy(left, row, 4);  // Original value of the pixel to the left.

    for (int x = 1; x < width; ++x) {
      uint8_t* pixel = row + 4 * x;
      uint8_t current[4];
      memcpy(current, pixel, 4);

      const bool is_edge =
          current[3] == 0xFF && left[3] == 0xFF &&
          (current[0] != left[0] || current[1] != left[1] ||
           current[2] != left[2]);
      if (is_edge) {
        const uint32_t rgb = (current[channel_offset[0]] << 16) |
                             (current[channel_offset[1]] << 8) |
                             current[channel_offset[2]];
        const uint64_t h = Mix(seed, origin_x + x, canvas_y, rgb);
        if (h % kEdgeSelectionRate == 0) {
          uint8_t& channel = pixel[channel_offset[(h >> 8) % 3]];
          const bool up = (h >> 16) & 1;
          if (channel == 0xFF) {
            --channel;
          } else if (channel == 0x00) {
            ++channel;
          } else {
            channel = up ? channel + 1 : channel - 1;
          }
        }
      }
      memcpy(left, current, 4);
    }
  }
}

void ApplyNoise(const SkPixmap& pixmap,
                int64_t origin_x,
                int64_t origin_y,
                uint64_t seed) {
  ApplyNoiseRows(static_cast<uint8_t*>(pixmap.writable_addr()),
                 pixmap.rowBytes(), pixmap.width(), pixmap.height(),
                 pixmap.colorType() == kBGRA_8888_SkColorType, origin_x,
                 origin_y, 1, seed);
}

}  // namespace

bool ProteusCanvasNoiseEnabled() {
  return base::proteus::GetConfig().canvas_noise;
}

void ProteusNoiseAndCopyRgba(base::span<uint8_t> scratch,
                             int width_with_context,
                             int height,
                             int64_t origin_x,
                             int64_t origin_y,
                             int y_step,
                             uint8_t* dst) {
  if (width_with_context < 2 || height < 1) {
    return;
  }
  const size_t scratch_row = static_cast<size_t>(width_with_context) * 4;
  const size_t dst_row = scratch_row - 4;
  CHECK_GE(scratch.size(), scratch_row * static_cast<size_t>(height));

  ApplyNoiseRows(scratch.data(), scratch_row, width_with_context, height,
                 /*is_bgra=*/false, origin_x, origin_y, y_step,
                 base::proteus::GetConfig().seed);
  for (int y = 0; y < height; ++y) {
    memcpy(dst + dst_row * static_cast<size_t>(y),
           scratch.data() + scratch_row * static_cast<size_t>(y) + 4, dst_row);
  }
}

scoped_refptr<StaticBitmapImage> ProteusNoisedCanvasImage(
    scoped_refptr<StaticBitmapImage> image) {
  const base::proteus::Config& config = base::proteus::GetConfig();
  if (!image || !config.canvas_noise) {
    return image;
  }

  scoped_refptr<StaticBitmapImage> software = image->MakeUnaccelerated();
  if (!software) {
    return image;
  }
  sk_sp<SkImage> source = software->PaintImageForCurrentFrame().GetSwSkImage();
  if (!source || !IsSupported(source->colorType())) {
    return image;
  }

  SkBitmap copy;
  if (!copy.tryAllocPixels(source->imageInfo()) ||
      !source->readPixels(copy.pixmap(), 0, 0)) {
    return image;
  }
  ApplyNoise(copy.pixmap(), 0, 0, config.seed);
  copy.setImmutable();
  return UnacceleratedStaticBitmapImage::Create(copy.asImage());
}

bool ProteusReadNoisedCanvasPixels(const cc::PaintImage& image,
                                   const SkPixmap& dst,
                                   int sx,
                                   int sy) {
  const base::proteus::Config& config = base::proteus::GetConfig();
  if (!config.canvas_noise || !IsSupported(dst.colorType()) ||
      dst.width() <= 0 || dst.height() <= 0 ||
      dst.width() == std::numeric_limits<int>::max() ||
      sx == std::numeric_limits<int>::min()) {
    return false;
  }

  // Read one extra column on the left so that the first requested column has
  // the same neighbour it would have in a full-canvas read.
  SkBitmap scratch;
  const SkImageInfo info = dst.info().makeWH(dst.width() + 1, dst.height());
  if (!scratch.tryAllocPixels(info)) {
    return false;
  }
  scratch.eraseColor(SK_ColorTRANSPARENT);
  if (!image.readPixels(info, scratch.getPixels(), scratch.rowBytes(), sx - 1,
                        sy)) {
    return false;
  }

  ApplyNoise(scratch.pixmap(), static_cast<int64_t>(sx) - 1, sy, config.seed);

  const size_t row_bytes = static_cast<size_t>(dst.width()) * 4;
  for (int y = 0; y < dst.height(); ++y) {
    memcpy(dst.writable_addr(0, y), scratch.pixmap().addr(1, y), row_bytes);
  }
  return true;
}

}  // namespace blink

// Copyright 2026 The Proteus Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#include "third_party/blink/renderer/modules/webaudio/proteus_audio_noise.h"

#include <stdint.h>

#include <cmath>
#include <limits>

#include "base/bit_cast.h"
#include "base/containers/span.h"
#include "base/proteus/proteus_config.h"
#include "third_party/blink/renderer/core/typed_arrays/dom_typed_array.h"
#include "third_party/blink/renderer/modules/webaudio/audio_buffer.h"

namespace blink {

namespace {

// One changing sample in this many is perturbed.
constexpr uint64_t kSampleSelectionRate = 4;

// The decision for a sample depends only on the seed, the sample and the one
// before it, not on its position or channel: one source feeding two channels
// must still give two identical channels.
uint64_t Mix(uint64_t seed, uint32_t bits, uint32_t previous_bits) {
  uint64_t h = seed;
  h ^= static_cast<uint64_t>(bits) * 0x9E3779B97F4A7C15ull;
  h ^= static_cast<uint64_t>(previous_bits) * 0xC2B2AE3D27D4EB4Full;
  h ^= h >> 30;
  h *= 0xBF58476D1CE4E5B9ull;
  h ^= h >> 27;
  h *= 0x94D049BB133111EBull;
  h ^= h >> 31;
  return h;
}

void ApplyNoise(base::span<float> samples, uint64_t seed) {
  if (samples.empty()) {
    return;
  }
  float previous = samples[0];  // Original value of the preceding sample.
  for (size_t i = 1; i < samples.size(); ++i) {
    const float current = samples[i];
    if (current != previous && current != 0.0f && std::isfinite(current)) {
      const uint64_t h = Mix(seed, base::bit_cast<uint32_t>(current),
                             base::bit_cast<uint32_t>(previous));
      if (h % kSampleSelectionRate == 0) {
        const float toward = (h >> 8) & 1
                                 ? std::numeric_limits<float>::infinity()
                                 : -std::numeric_limits<float>::infinity();
        const float nudged = std::nextafter(current, toward);
        if (std::isfinite(nudged) && nudged != 0.0f) {
          samples[i] = nudged;
        }
      }
    }
    previous = current;
  }
}

}  // namespace

void ProteusApplyAudioNoise(AudioBuffer* buffer) {
  const base::proteus::Config& config = base::proteus::GetConfig();
  if (!buffer || !config.audio_noise) {
    return;
  }
  for (unsigned channel = 0; channel < buffer->numberOfChannels(); ++channel) {
    NotShared<DOMFloat32Array> data = buffer->getChannelData(channel);
    if (!data.Get()) {
      continue;
    }
    ApplyNoise(data->AsSpan(), config.seed);
  }
}

}  // namespace blink

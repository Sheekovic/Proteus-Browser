// Copyright 2026 The Proteus Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#ifndef THIRD_PARTY_BLINK_RENDERER_MODULES_WEBAUDIO_PROTEUS_AUDIO_NOISE_H_
#define THIRD_PARTY_BLINK_RENDERER_MODULES_WEBAUDIO_PROTEUS_AUDIO_NOISE_H_

namespace blink {

class AudioBuffer;

// Offline audio render noise.
//
// When the active Proteus profile enables audio noise, the result of an
// OfflineAudioContext render is perturbed once, before script can see it, so
// that the audio fingerprint is unique to the profile. Because the buffer
// itself is changed, getChannelData(), copyFromChannel() and playing the buffer
// back all agree. The perturbation is a pure function of (profile seed,
// channel, sample index, sample value, previous sample):
//   * the same graph rendered twice yields identical samples;
//   * silence and constant signals are never touched - only a sample that
//     differs from its predecessor can change, to an adjacent float value.
void ProteusApplyAudioNoise(AudioBuffer* buffer);

}  // namespace blink

#endif  // THIRD_PARTY_BLINK_RENDERER_MODULES_WEBAUDIO_PROTEUS_AUDIO_NOISE_H_

// Copyright 2026 The Proteus Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#ifndef THIRD_PARTY_BLINK_RENDERER_MODULES_MEDIASTREAM_PROTEUS_MEDIA_DEVICES_H_
#define THIRD_PARTY_BLINK_RENDERER_MODULES_MEDIASTREAM_PROTEUS_MEDIA_DEVICES_H_

#include <string>

#include "third_party/blink/public/common/mediastream/media_devices.h"
#include "third_party/blink/public/mojom/mediastream/media_devices.mojom-blink.h"
#include "third_party/blink/renderer/platform/wtf/text/wtf_string.h"
#include "third_party/blink/renderer/platform/wtf/vector.h"

namespace blink {

// The microphones, cameras and speakers of the profile's machine.
//
// navigator.mediaDevices.enumerateDevices() tells a page which kinds of device a
// machine has even before it asks for permission, and their names once it was
// allowed to use one: "Integrated Webcam (0c45:6730)" names a laptop model, and a
// "phone" with three microphones and a Realtek sound card is not a phone. With a
// profile that lists its devices, the page sees that list instead.
//
// A site that was not given permission gets what an ordinary browser gives it:
// one nameless entry for each kind the profile has. After permission, each
// listed device stands for one of this machine's, in order, so that choosing it
// by id still works; a listed device this machine has no counterpart for gets an
// id of its own, stable for the profile and different on every site, and cannot
// be opened - as with a camera that is unplugged or in use.
//
// Fills |listed| from |real| and brings both capability lists in line with it.
// Returns false, touching nothing, when the profile does not list devices.
bool ProteusRewriteMediaDevices(
    const Vector<Vector<WebMediaDeviceInfo>>& real,
    Vector<Vector<WebMediaDeviceInfo>>& listed,
    Vector<mojom::blink::VideoInputDeviceCapabilitiesPtr>& video_capabilities,
    Vector<mojom::blink::AudioInputDeviceCapabilitiesPtr>& audio_capabilities);

// MediaStreamTrack.label for a microphone or camera that was opened: the label
// the profile gives that device, so that it agrees with the list above.
String ProteusMediaTrackLabel(bool audio,
                              const std::string& real_id,
                              const std::string& real_label);

// The id of that track's device, as MediaStreamTrack.getSettings() reports it. The
// operating system's "default" entry is what a page gets when it does not choose;
// a profile whose list has no such entry (a phone) shows the first listed device
// instead, once the list has been read.
String ProteusMediaTrackDeviceId(bool audio, const std::string& real_id);

}  // namespace blink

#endif  // THIRD_PARTY_BLINK_RENDERER_MODULES_MEDIASTREAM_PROTEUS_MEDIA_DEVICES_H_

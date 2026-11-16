// Copyright 2026 The Proteus Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#include "third_party/blink/renderer/modules/mediastream/proteus_media_devices.h"

#include <stdint.h>

#include <map>
#include <utility>

#include "base/no_destructor.h"
#include "base/proteus/proteus_config.h"
#include "base/strings/stringprintf.h"

namespace blink {

namespace {

using base::proteus::Config;

constexpr wtf_size_t kAudioInput = 0;
constexpr wtf_size_t kVideoInput = 1;
constexpr wtf_size_t kKinds = 3;

// The entries an operating system adds for the device it would pick itself.
bool IsChosenDeviceEntry(const std::string& id) {
  return id == "default" || id == "communications";
}

uint64_t Mix(uint64_t value) {
  value += 0x9E3779B97F4A7C15ull;
  value = (value ^ (value >> 30)) * 0xBF58476D1CE4E5B9ull;
  value = (value ^ (value >> 27)) * 0x94D049BB133111EBull;
  return value ^ (value >> 31);
}

uint64_t HashOf(const std::string& text) {
  uint64_t hash = 0xCBF29CE484222325ull;
  for (const unsigned char c : text) {
    hash = (hash ^ c) * 0x100000001B3ull;
  }
  return hash;
}

// An id shaped like the ones the browser hands out (64 hexadecimal digits) for a
// device that exists only in the profile. |site| comes from a real id, which the
// browser makes different for every site.
std::string MadeUpId(uint64_t site, wtf_size_t kind, wtf_size_t ordinal,
                     int purpose) {
  uint64_t state = Mix(base::proteus::GetConfig().seed ^ site) ^
                   Mix((uint64_t{kind} << 32) | (uint64_t{ordinal} << 8) |
                       static_cast<uint64_t>(purpose));
  std::string id;
  for (int i = 0; i < 4; ++i) {
    state = Mix(state);
    id += base::StringPrintf("%016llx", static_cast<unsigned long long>(state));
  }
  return id;
}

// This machine's device names and the profile's names for them, for the tracks
// opened later. Filled and read on the main thread only.
std::map<std::string, std::string>& KnownLabels(bool audio) {
  static base::NoDestructor<std::map<std::string, std::string>> microphones;
  static base::NoDestructor<std::map<std::string, std::string>> cameras;
  return audio ? *microphones : *cameras;
}

// The listed device that stands for this machine's "default" (index 0) and
// "communications" (index 1) entries where the profile has no such entry.
std::string& ChosenDeviceStandIn(bool audio, const std::string& id) {
  static base::NoDestructor<std::string> microphone_default;
  static base::NoDestructor<std::string> microphone_communications;
  static base::NoDestructor<std::string> camera_default;
  static base::NoDestructor<std::string> camera_communications;
  if (audio) {
    return id == "default" ? *microphone_default : *microphone_communications;
  }
  return id == "default" ? *camera_default : *camera_communications;
}

template <typename CapabilitiesPtr>
void BringInLine(Vector<CapabilitiesPtr>& capabilities,
                 const Vector<int>& sources,
                 const Vector<WebMediaDeviceInfo>& listed) {
  if (capabilities.empty()) {
    return;
  }
  Vector<CapabilitiesPtr> result;
  for (wtf_size_t i = 0; i < listed.size(); ++i) {
    const wtf_size_t from =
        sources[i] >= 0 && static_cast<wtf_size_t>(sources[i]) <
                               capabilities.size()
            ? static_cast<wtf_size_t>(sources[i])
            : 0;
    CapabilitiesPtr one = capabilities[from].Clone();
    one->device_id = String::FromUtf8(listed[i].device_id);
    one->group_id = String::FromUtf8(listed[i].group_id);
    result.push_back(std::move(one));
  }
  capabilities = std::move(result);
}

}  // namespace

bool ProteusRewriteMediaDevices(
    const Vector<Vector<WebMediaDeviceInfo>>& real,
    Vector<Vector<WebMediaDeviceInfo>>& listed,
    Vector<mojom::blink::VideoInputDeviceCapabilitiesPtr>& video_capabilities,
    Vector<mojom::blink::AudioInputDeviceCapabilitiesPtr>& audio_capabilities) {
  const Config& config = base::proteus::GetConfig();
  if (!config.has_media_devices) {
    return false;
  }
  listed.clear();
  listed.resize(real.size());
  for (wtf_size_t kind = 0; kind < real.size() && kind < kKinds; ++kind) {
    const Vector<WebMediaDeviceInfo>& have = real[kind];
    const std::vector<Config::MediaDevice>& want = config.media_devices[kind];
    Vector<int> sources;

    // Without permission the browser sends nameless entries; the devices
    // themselves, apart from the operating system's "default" entries, are the
    // ones the profile's devices can stand for.
    bool allowed = false;
    Vector<wtf_size_t> devices;
    for (wtf_size_t j = 0; j < have.size(); ++j) {
      allowed = allowed || !have[j].device_id.empty();
      if (!IsChosenDeviceEntry(have[j].device_id)) {
        devices.push_back(j);
      }
    }

    if (!allowed) {
      if (!want.empty()) {
        listed[kind].push_back(
            WebMediaDeviceInfo(std::string(), std::string(), std::string()));
        sources.push_back(have.empty() ? -1 : 0);
      }
    } else {
      const uint64_t site =
          HashOf(have[devices.empty() ? 0 : devices[0]].device_id);
      wtf_size_t next = 0;
      for (const Config::MediaDevice& device : want) {
        WebMediaDeviceInfo info{std::string(), std::string(), std::string()};
        int source = -1;
        bool stands_for_source = false;
        if (!device.id.empty()) {
          for (wtf_size_t j = 0; j < have.size(); ++j) {
            if (have[j].device_id == device.id) {
              source = static_cast<int>(j);
              stands_for_source = true;
            }
          }
          // Such an entry belongs to the group of the device it points at: the
          // first one, as far as a page can tell.
          if (source < 0 && !devices.empty()) {
            source = static_cast<int>(devices[0]);
          }
          if (source >= 0) {
            info = have[source];
          } else {
            info.group_id = MadeUpId(site, kind, 0, 1);
          }
          info.device_id = device.id;
        } else {
          if (next < devices.size()) {
            source = static_cast<int>(devices[next]);
            stands_for_source = true;
            info = have[source];
          } else {
            info.device_id = MadeUpId(site, kind, next, 0);
            info.group_id = MadeUpId(site, kind, next, 1);
          }
          ++next;
        }
        if (stands_for_source && kind != 2) {
          KnownLabels(kind == kAudioInput)[have[source].label] = device.label;
        }
        info.label = device.label;
        listed[kind].push_back(std::move(info));
        sources.push_back(source);
      }
    }

    if (allowed && kind != 2) {
      for (const char* chosen : {"default", "communications"}) {
        std::string stand_in;
        for (const WebMediaDeviceInfo& info : listed[kind]) {
          if (info.device_id == chosen) {
            stand_in.clear();
            break;
          }
          if (stand_in.empty() && !IsChosenDeviceEntry(info.device_id)) {
            stand_in = info.device_id;
          }
        }
        ChosenDeviceStandIn(kind == kAudioInput, chosen) = stand_in;
      }
    }

    if (kind == kVideoInput) {
      BringInLine(video_capabilities, sources, listed[kind]);
    } else if (kind == kAudioInput) {
      BringInLine(audio_capabilities, sources, listed[kind]);
    }
  }
  return true;
}

String ProteusMediaTrackLabel(bool audio,
                              const std::string& real_id,
                              const std::string& real_label) {
  const Config& config = base::proteus::GetConfig();
  if (!config.has_media_devices) {
    return String::FromUtf8(real_label);
  }
  const std::map<std::string, std::string>& known = KnownLabels(audio);
  if (const auto it = known.find(real_label); it != known.end()) {
    return String::FromUtf8(it->second);
  }
  // Opened before the page looked at the list: the operating system's chosen
  // device if that is what was opened, otherwise the first device.
  const std::vector<Config::MediaDevice>& devices =
      config.media_devices[audio ? 0 : 1];
  const bool chosen = IsChosenDeviceEntry(real_id);
  for (const Config::MediaDevice& device : devices) {
    if (chosen ? device.id == real_id : device.id.empty()) {
      return String::FromUtf8(device.label);
    }
  }
  return devices.empty() ? String::FromUtf8(real_label)
                         : String::FromUtf8(devices[0].label);
}

String ProteusMediaTrackDeviceId(bool audio, const std::string& real_id) {
  if (base::proteus::GetConfig().has_media_devices &&
      IsChosenDeviceEntry(real_id)) {
    const std::string& stand_in = ChosenDeviceStandIn(audio, real_id);
    if (!stand_in.empty()) {
      return String::FromUtf8(stand_in);
    }
  }
  return String::FromUtf8(real_id);
}

}  // namespace blink

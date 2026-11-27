// Copyright 2026 The Proteus Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#ifndef BASE_PROTEUS_PROTEUS_PLACE_H_
#define BASE_PROTEUS_PROTEUS_PLACE_H_

#include <optional>
#include <string>
#include <string_view>

#include "base/base_export.h"
#include "base/functional/callback.h"

namespace base::proteus {

// The name of the switch a child process started after a move is given the place
// with (the place's text, base64).
BASE_EXPORT extern const char kPlaceSwitch[];

// Where a profile is: the part of its configuration that follows the address its
// connections come out at, and so the part that may change while it runs. A proxy
// that starts coming out somewhere else has moved the browser there, as a laptop
// carried to another country is moved: its time zone, languages, position and
// the address WebRTC shows are then the new place's.
//
// Everything else of a profile is read once (proteus_config.h) and stays.
struct BASE_EXPORT Place {
  Place();
  Place(const Place&);
  Place& operator=(const Place&);
  ~Place();

  // IANA time zone id, or empty for the host's.
  std::string timezone;
  // Preferred languages, most preferred first, comma separated; empty for the
  // browser's own.
  std::string accept_languages;
  // The public address WebRTC reports, or empty for none.
  std::string webrtc_public_ip;
  // The position navigator.geolocation reports, if any.
  bool has_geolocation = false;
  double geolocation_latitude = 0;
  double geolocation_longitude = 0;
  double geolocation_accuracy = 0;
};

// The place as it is now, in this process. It starts as the configuration's (or,
// in a process started after a move, as the place that process was given). The
// reference stays valid for the life of the process: a replaced place is kept.
// Safe on any thread.
BASE_EXPORT const Place& GetPlace();

// Replaces the place in this process and runs the observers. Safe on any thread.
BASE_EXPORT void SetPlace(Place place);

// Whether the place has been replaced since this process read its configuration.
BASE_EXPORT bool PlaceHasMoved();

// Runs `observer` after every SetPlace(), on the thread that called it; bind it to
// the sequence it belongs on. Observers are never removed: bind weakly.
BASE_EXPORT void AddPlaceObserver(RepeatingClosure observer);

// A place as one line of text that is no time zone's name, to send where a time
// zone's name is sent, and back. PlaceFromMessage gives nothing for a text that
// is not such a line.
BASE_EXPORT std::string PlaceMessage(const Place& place);
BASE_EXPORT std::optional<Place> PlaceFromMessage(std::string_view message);

// The value of kPlaceSwitch for a child process started now, or empty when the
// place has not moved (the child then reads the configuration, as before).
BASE_EXPORT std::string PlaceSwitchValue();

// In the browser process of a profile started from a configuration file: looks
// now and then at "place.json" beside that file and makes what it holds the
// place. The file has the configuration's own keys: "timezone", "languages",
// "geolocation" and "webRtcPublicIp". Once the place is taken, the file's "id"
// (any text) is written to "place.taken" beside it, which tells the writer that
// this browser can be moved and has been. A file that was there at the start is
// not read until it changes. Does nothing without a configuration file, and nothing
// the second time.
BASE_EXPORT void WatchPlaceFile();

}  // namespace base::proteus

#endif  // BASE_PROTEUS_PROTEUS_PLACE_H_

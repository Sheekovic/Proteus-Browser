// Copyright 2026 The Proteus Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#ifndef THIRD_PARTY_BLINK_RENDERER_MODULES_PEERCONNECTION_PROTEUS_WEBRTC_SPOOF_H_
#define THIRD_PARTY_BLINK_RENDERER_MODULES_PEERCONNECTION_PROTEUS_WEBRTC_SPOOF_H_

#include "third_party/blink/renderer/platform/wtf/text/wtf_string.h"
#include "third_party/blink/renderer/platform/wtf/vector.h"

namespace blink {

// Presentational ICE candidates.
//
// A profile in WebRTC "proxy only" mode sends no direct UDP, so ICE gathering
// yields nothing - which is safe, but an empty candidate list is itself unusual.
// When the profile also names the public address to show, the page is given the
// candidates a normal browser behind that address would report: a host candidate
// hidden behind an mDNS name and, if the page configured a STUN or TURN server,
// a server-reflexive candidate carrying the public address.
//
// These candidates are for display only. Nothing listens on them and no packet
// is sent for them; the machine's real addresses never appear.

// The candidates to announce for a connection whose local description is
// |local_sdp|. Empty when the profile does not ask for this, when the
// description is not usable, or when it already holds real candidates (the
// proxy carried UDP, so nothing needs inventing).
struct ProteusIceCandidates {
  // "candidate:..." strings, in the order to announce them.
  Vector<String> candidates;
  // sdpMid and usernameFragment shared by all of them.
  String mid;
  String username_fragment;
};
ProteusIceCandidates ProteusBuildIceCandidates(const String& local_sdp,
                                               bool has_stun_or_turn_server);

// |local_sdp| with those candidates written into its first media section, as
// they would appear once gathering has finished. Returns |local_sdp| unchanged
// when there is nothing to add.
String ProteusSdpWithIceCandidates(const String& local_sdp,
                                   bool has_stun_or_turn_server);

}  // namespace blink

#endif  // THIRD_PARTY_BLINK_RENDERER_MODULES_PEERCONNECTION_PROTEUS_WEBRTC_SPOOF_H_

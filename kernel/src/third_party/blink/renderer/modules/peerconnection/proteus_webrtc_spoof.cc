// Copyright 2026 The Proteus Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#include "third_party/blink/renderer/modules/peerconnection/proteus_webrtc_spoof.h"

#include <stdint.h>

#include <string>
#include <string_view>
#include <vector>

#include "base/containers/span.h"
#include "base/no_destructor.h"
#include "base/proteus/proteus_config.h"
#include "base/proteus/proteus_place.h"
#include "base/strings/stringprintf.h"
#include "base/uuid.h"

namespace blink {

namespace {

uint64_t Mix(uint64_t seed, std::string_view text) {
  uint64_t h = seed ^ 0x9E3779B97F4A7C15ull;
  for (char c : text) {
    h ^= static_cast<uint8_t>(c);
    h *= 0x100000001B3ull;
  }
  h ^= h >> 30;
  h *= 0xBF58476D1CE4E5B9ull;
  h ^= h >> 27;
  h *= 0x94D049BB133111EBull;
  h ^= h >> 31;
  return h;
}

// The mDNS name standing in for the local address. A browser keeps one name per
// local address for the life of the process, so this is chosen once.
const std::string& MdnsHostname() {
  static const base::NoDestructor<std::string> name(
      base::Uuid::GenerateRandomV4().AsLowercaseString() + ".local");
  return *name;
}

// Value of the first "a=<name>:" attribute in |sdp|, or an empty string.
std::string Attribute(const std::string& sdp, std::string_view name) {
  const std::string key = "a=" + std::string(name) + ":";
  size_t start = sdp.find(key);
  if (start == std::string::npos) {
    return std::string();
  }
  start += key.size();
  size_t end = sdp.find_first_of("\r\n", start);
  if (end == std::string::npos) {
    end = sdp.size();
  }
  return sdp.substr(start, end - start);
}

struct Candidates {
  std::vector<std::string> lines;
  std::string mid;
  std::string username_fragment;
};

Candidates Build(const std::string& sdp, bool has_stun_or_turn_server) {
  Candidates result;
  const base::proteus::Config& config = base::proteus::GetConfig();
  if (!config.webrtc_proxy_only ||
      sdp.find("a=candidate:") != std::string::npos) {
    return result;
  }
  result.username_fragment = Attribute(sdp, "ice-ufrag");
  result.mid = Attribute(sdp, "mid");
  if (result.username_fragment.empty() || result.mid.empty()) {
    return result;
  }

  // A candidate's foundation identifies its type and base address, so it is
  // the same for every connection of a profile. The port is per connection.
  const uint32_t host_foundation =
      static_cast<uint32_t>(Mix(config.seed, "host-foundation"));
  const uint32_t srflx_foundation =
      static_cast<uint32_t>(Mix(config.seed, "srflx-foundation"));
  const int port = 49152 + static_cast<int>(
                               Mix(config.seed, result.username_fragment) %
                               (65535 - 49152));
  const char* ufrag = result.username_fragment.c_str();

  result.lines.push_back(base::StringPrintf(
      "candidate:%u 1 udp 2113937151 %s %d typ host generation 0 ufrag %s "
      "network-cost 999",
      host_foundation, MdnsHostname().c_str(), port, ufrag));
  // The public candidate needs an address to show; the host candidate does not,
  // and a browser that reports no candidate at all leaves pages waiting forever.
  // The address is the place's (patch 0043): the one the proxy comes out at now.
  const std::string& public_ip = base::proteus::GetPlace().webrtc_public_ip;
  if (has_stun_or_turn_server && !public_ip.empty()) {
    result.lines.push_back(base::StringPrintf(
        "candidate:%u 1 udp 1677729535 %s %d typ srflx raddr 0.0.0.0 rport 0 "
        "generation 0 ufrag %s network-cost 999",
        srflx_foundation, public_ip.c_str(), port, ufrag));
  }
  return result;
}

String ToString(const std::string& utf8) {
  return String::FromUtf8(base::as_byte_span(utf8));
}

}  // namespace

ProteusIceCandidates ProteusBuildIceCandidates(const String& local_sdp,
                                               bool has_stun_or_turn_server) {
  ProteusIceCandidates result;
  if (local_sdp.IsNull()) {
    return result;
  }
  const Candidates built = Build(local_sdp.Utf8(), has_stun_or_turn_server);
  for (const std::string& line : built.lines) {
    result.candidates.push_back(ToString(line));
  }
  result.mid = ToString(built.mid);
  result.username_fragment = ToString(built.username_fragment);
  return result;
}

String ProteusSdpWithIceCandidates(const String& local_sdp,
                                   bool has_stun_or_turn_server) {
  if (local_sdp.IsNull()) {
    return local_sdp;
  }
  const std::string sdp = local_sdp.Utf8();
  const Candidates built = Build(sdp, has_stun_or_turn_server);
  if (built.lines.empty()) {
    return local_sdp;
  }
  // Candidates follow the connection ("c=") line of their media section.
  const size_t media = sdp.find("\r\nm=");
  if (media == std::string::npos) {
    return local_sdp;
  }
  const size_t connection = sdp.find("\r\nc=", media + 2);
  if (connection == std::string::npos) {
    return local_sdp;
  }
  const size_t insert_at = sdp.find("\r\n", connection + 2);
  if (insert_at == std::string::npos) {
    return local_sdp;
  }
  std::string lines;
  for (const std::string& line : built.lines) {
    lines += "\r\na=" + line;
  }
  lines += "\r\na=end-of-candidates";
  return ToString(sdp.substr(0, insert_at) + lines + sdp.substr(insert_at));
}

}  // namespace blink

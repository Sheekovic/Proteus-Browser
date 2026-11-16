// Copyright 2026 The Proteus Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#ifndef BASE_PROTEUS_PROTEUS_CONFIG_H_
#define BASE_PROTEUS_PROTEUS_CONFIG_H_

#include <stdint.h>

#include <optional>
#include <string>
#include <utility>
#include <vector>

#include "base/base_export.h"

namespace base::proteus {

// --proteus-config=<path>: JSON profile configuration. Read once by the browser
// process, which is the only process allowed to touch the file system.
BASE_EXPORT extern const char kConfigFileSwitch[];

// --proteus-config-data=<base64 JSON>: the same configuration, handed by the
// browser process to every child process it launches.
BASE_EXPORT extern const char kConfigDataSwitch[];

// One entry of a User-Agent Client Hints brand list, e.g. {"Chromium", "158"}.
struct BASE_EXPORT UaBrand {
  std::string brand;
  std::string version;
};

// User-Agent Client Hints: navigator.userAgentData and the Sec-CH-UA-* headers.
struct BASE_EXPORT UaData {
  UaData();
  UaData(const UaData&);
  UaData& operator=(const UaData&);
  ~UaData();

  // The browser's brand name, e.g. "Google Chrome". When set (together with
  // |full_version|), the brand lists are generated the way a branded browser of
  // that version builds them - including the GREASE entry and the ordering,
  // both of which change with every major version - and |brands| /
  // |full_version_list| are ignored.
  std::string brand;

  std::vector<UaBrand> brands;             // Sec-CH-UA
  std::vector<UaBrand> full_version_list;  // Sec-CH-UA-Full-Version-List
  std::string full_version;
  std::string platform;          // "Windows", "macOS", "Linux", ...
  std::string platform_version;  // "15.0.0"
  std::string architecture;      // "x86", "arm"
  std::string bitness;           // "64"
  std::string model;
  bool mobile = false;
  bool wow64 = false;
};

// A font family and the families that may stand in for it, in order of preference.
struct BASE_EXPORT FontAlias {
  FontAlias();
  FontAlias(const FontAlias&);
  FontAlias& operator=(const FontAlias&);
  ~FontAlias();

  std::string family;
  std::vector<std::string> substitutes;
};

// One entry of speechSynthesis.getVoices().
struct BASE_EXPORT Voice {
  Voice();
  Voice(const Voice&);
  Voice& operator=(const Voice&);
  ~Voice();

  std::string name;
  std::string lang;       // BCP 47 tag, e.g. "en-US"
  bool local = true;      // localService
  bool is_default = false;
};

// window.screen and the device-width / device-height media features, in CSS
// pixels.
struct BASE_EXPORT ScreenData {
  int width = 0;
  int height = 0;
  int avail_width = 0;
  int avail_height = 0;
  int color_depth = 24;
};

// Per-profile identity settings. Every field is optional; an absent field means
// "report the real value of this machine".
struct BASE_EXPORT Config {
  Config();
  Config(const Config&);
  Config& operator=(const Config&);
  ~Config();

  // True when a configuration was supplied and parsed successfully.
  bool active = false;

  // Stable per-profile seed for deterministic noise.
  uint64_t seed = 0;

  // navigator.hardwareConcurrency
  std::optional<int> hardware_concurrency;

  // navigator.deviceMemory, in GiB.
  std::optional<double> device_memory;

  // navigator.userAgent and the User-Agent request header. Empty means real.
  std::string user_agent;

  // navigator.platform, e.g. "Win32", "MacIntel", "Linux x86_64". Empty means
  // real.
  std::string navigator_platform;

  // User-Agent Client Hints. Absent means real.
  std::optional<UaData> ua_data;

  // Screen geometry. Absent means real.
  std::optional<ScreenData> screen;

  // Preferred languages, most preferred first, comma separated ("de-DE,de,en").
  // Drives navigator.languages and the Accept-Language header. Empty means
  // real.
  std::string accept_languages;

  // IANA time zone id ("America/New_York"). Empty means real.
  std::string timezone;

  // Font families a page may find installed. Any other installed family is
  // hidden from font-family matching and local() sources. Empty means "all
  // fonts on this machine".
  std::vector<std::string> fonts;

  // Stand-ins for fonts the profile claims but the machine may lack. When a
  // family named here is not installed, the first installed substitute is used
  // in its place, so the family is still found. An installed family always
  // wins over its substitutes.
  std::vector<FontAlias> font_aliases;

  // When true, WebRTC may only send traffic through the configured proxy: no
  // direct UDP leaves the machine, so neither a STUN server nor the page can
  // learn the real public or local address.
  bool webrtc_proxy_only = false;

  // Public address to show in WebRTC, normally the proxy's exit address. With
  // |webrtc_proxy_only|, a page then sees the ICE candidates an ordinary browser
  // behind that address would produce (an mDNS host candidate and, when it
  // configured a STUN or TURN server, a server-reflexive one carrying this
  // address) while still no direct UDP leaves the machine. Empty means "show
  // no candidates".
  std::string webrtc_public_ip;

  // Whether canvas readbacks (2D and WebGL) carry seed-derived noise.
  bool canvas_noise = false;

  // Whether offline audio renders carry seed-derived noise.
  bool audio_noise = false;

  // WEBGL_debug_renderer_info strings. Empty means "report the real GPU".
  std::string webgl_vendor;
  std::string webgl_renderer;

  // What the graphics card named above can do, as WebGL reports it; index 0 is for
  // WebGL 1 contexts and 1 for WebGL 2. Unset means "report the real GPU".
  struct WebGLCaps {
    // getParameter() results by parameter name (a GL enum): one number, or the
    // numbers of an array result. Used only where the real result has that shape.
    std::vector<std::pair<uint32_t, std::vector<double>>> params;
    // The extensions that card offers. With |has_extensions| set, extensions not
    // listed are neither reported nor handed out; listed ones the real GPU lacks
    // stay unavailable.
    bool has_extensions = false;
    std::vector<std::string> extensions;
    // getShaderPrecisionFormat() results: 36 numbers, for the vertex then the
    // fragment shader, for low/medium/high float then low/medium/high int, each
    // as range minimum, range maximum, precision. Empty means the real ones.
    std::vector<int> shader_precision;
  };
  WebGLCaps webgl_caps[2];

  // GPUAdapterInfo.vendor / .architecture ("intel" / "gen-12lp"), which must
  // agree with the WebGL strings. Empty means "report the real GPU".
  std::string webgpu_vendor;
  std::string webgpu_architecture;

  // The speech synthesis voices to report; they differ by operating system.
  // Empty means "report this machine's voices".
  std::vector<Voice> voices;

  // The position navigator.geolocation reports once a site is allowed to ask,
  // in degrees and metres. When set, the machine's own location services are
  // never consulted. Unset means stock behaviour.
  // Phone profile. When set, every page is laid out and reported as on a phone
  // of this size: mobile viewport rules, touch input with |max_touch_points|
  // fingers, the screen from |screen|, a view of |mobile_view_*| CSS pixels at
  // |mobile_device_scale_factor| device pixels each, no plugins.
  bool mobile = false;
  int mobile_max_touch_points = 5;
  double mobile_device_scale_factor = 2.0;
  int mobile_view_width = 0;
  int mobile_view_height = 0;
  // Phones other than Android ones keep the built-in PDF viewer plugins.
  bool mobile_pdf_viewer = false;

  // Identity of a browser from another vendor. |vendor| replaces
  // navigator.vendor when not empty. |hidden_members| lists, per interface
  // name ("Navigator", "WorkerNavigator", ...), members that browser does not
  // have; they are removed from the interface in every script context.
  // |client_hints| false sends no client hint request headers at all and
  // |chrome_object| false leaves pages without window.chrome.
  struct HiddenMembers {
    std::string interface_name;
    std::vector<std::string> members;
  };
  std::string vendor;
  std::vector<HiddenMembers> hidden_members;
  bool client_hints = true;
  bool chrome_object = true;

  bool has_geolocation = false;
  double geolocation_latitude = 0;
  double geolocation_longitude = 0;
  double geolocation_accuracy = 0;

  // Base64 form of the source JSON, forwarded to child processes.
  std::string serialized;
};

// Returns the configuration of the current process. Parsed on first use and
// immutable afterwards; safe to call from any thread.
BASE_EXPORT const Config& GetConfig();

}  // namespace base::proteus

#endif  // BASE_PROTEUS_PROTEUS_CONFIG_H_

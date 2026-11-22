// Copyright 2026 The Proteus Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#include "base/proteus/proteus_config.h"

#include <optional>
#include <string_view>
#include <utility>
#include <vector>

#include "base/base64.h"
#include "base/command_line.h"
#include "base/containers/span.h"
#include "base/files/file_path.h"
#include "base/files/file_util.h"
#include "base/json/json_reader.h"
#include "base/logging.h"
#include "base/no_destructor.h"
#include "base/strings/string_number_conversions.h"
#include "base/values.h"

namespace base::proteus {

const char kConfigFileSwitch[] = "proteus-config";
const char kConfigDataSwitch[] = "proteus-config-data";

namespace {

// Profile configurations are small; refuse anything implausibly large.
constexpr size_t kMaxConfigBytes = 1024 * 1024;

// Returns the raw JSON for this process, or an empty string if none was given.
std::string ReadConfigJson() {
  if (!CommandLine::InitializedForCurrentProcess()) {
    return std::string();
  }
  const CommandLine& command_line = *CommandLine::ForCurrentProcess();

  if (command_line.HasSwitch(kConfigDataSwitch)) {
    std::optional<std::vector<uint8_t>> decoded =
        Base64Decode(command_line.GetSwitchValueASCII(kConfigDataSwitch));
    if (!decoded) {
      LOG(ERROR) << "Proteus: malformed --" << kConfigDataSwitch;
      return std::string();
    }
    return std::string(decoded->begin(), decoded->end());
  }

  if (command_line.HasSwitch(kConfigFileSwitch)) {
    const FilePath path = command_line.GetSwitchValuePath(kConfigFileSwitch);
    std::string json;
    if (!ReadFileToStringWithMaxSize(path, &json, kMaxConfigBytes)) {
      LOG(ERROR) << "Proteus: cannot read config file " << path;
      return std::string();
    }
    return json;
  }

  return std::string();
}

// The seed may be written as a JSON number or, to keep all 64 bits, a string.
uint64_t ParseSeed(const DictValue& dict) {
  if (const std::string* text = dict.FindString("seed")) {
    uint64_t seed = 0;
    if (StringToUint64(*text, &seed)) {
      return seed;
    }
    return 0;
  }
  if (std::optional<double> number = dict.FindDouble("seed")) {
    return *number > 0 ? static_cast<uint64_t>(*number) : 0;
  }
  return 0;
}

std::string StringOrEmpty(const DictValue& dict, std::string_view key) {
  const std::string* value = dict.FindString(key);
  return value ? *value : std::string();
}

std::vector<UaBrand> ParseBrands(const DictValue& dict, std::string_view key) {
  std::vector<UaBrand> brands;
  const ListValue* list = dict.FindList(key);
  if (!list) {
    return brands;
  }
  for (const Value& item : *list) {
    const DictValue* entry = item.GetIfDict();
    if (!entry) {
      continue;
    }
    UaBrand brand;
    brand.brand = StringOrEmpty(*entry, "brand");
    brand.version = StringOrEmpty(*entry, "version");
    if (!brand.brand.empty()) {
      brands.push_back(std::move(brand));
    }
  }
  return brands;
}

UaData ParseUaData(const DictValue& dict) {
  UaData data;
  data.brand = StringOrEmpty(dict, "brand");
  data.brands = ParseBrands(dict, "brands");
  data.full_version_list = ParseBrands(dict, "fullVersionList");
  data.full_version = StringOrEmpty(dict, "fullVersion");
  data.platform = StringOrEmpty(dict, "platform");
  data.platform_version = StringOrEmpty(dict, "platformVersion");
  data.architecture = StringOrEmpty(dict, "architecture");
  data.bitness = StringOrEmpty(dict, "bitness");
  data.model = StringOrEmpty(dict, "model");
  data.mobile = dict.FindBool("mobile").value_or(false);
  data.wow64 = dict.FindBool("wow64").value_or(false);
  return data;
}

Config LoadConfig() {
  Config config;
  const std::string json = ReadConfigJson();
  if (json.empty()) {
    return config;
  }

  std::optional<DictValue> dict = JSONReader::ReadDict(json, JSON_PARSE_RFC);
  if (!dict) {
    LOG(ERROR) << "Proteus: config is not a JSON object";
    return config;
  }

  config.active = true;
  config.seed = ParseSeed(*dict);
  // The zygote is launched before base::FeatureList exists, so the regular
  // Base64Encode(), which consults a feature, must not be used here.
  config.serialized = Base64EncodeEarlyStartup(as_byte_span(json));

  if (std::optional<int> value = dict->FindInt("hardwareConcurrency");
      value && *value > 0) {
    config.hardware_concurrency = *value;
  }
  if (std::optional<double> value = dict->FindDouble("deviceMemory");
      value && *value > 0) {
    config.device_memory = *value;
  }
  config.user_agent = StringOrEmpty(*dict, "userAgent");
  config.navigator_platform = StringOrEmpty(*dict, "platform");
  if (const DictValue* ua_data = dict->FindDict("uaData")) {
    config.ua_data = ParseUaData(*ua_data);
  }
  if (const DictValue* screen = dict->FindDict("screen")) {
    ScreenData data;
    data.width = screen->FindInt("width").value_or(0);
    data.height = screen->FindInt("height").value_or(0);
    data.avail_width = screen->FindInt("availWidth").value_or(data.width);
    data.avail_height = screen->FindInt("availHeight").value_or(data.height);
    data.color_depth = screen->FindInt("colorDepth").value_or(24);
    const int avail_top = screen->FindInt("availTop").value_or(0);
    if (avail_top > 0 && avail_top <= data.height - data.avail_height) {
      data.avail_top = avail_top;
    }
    if (data.width > 0 && data.height > 0) {
      config.screen = data;
    }
  }
  if (const ListValue* languages = dict->FindList("languages")) {
    for (const Value& language : *languages) {
      if (!language.is_string() || language.GetString().empty()) {
        continue;
      }
      if (!config.accept_languages.empty()) {
        config.accept_languages += ",";
      }
      config.accept_languages += language.GetString();
    }
  }
  if (const ListValue* fonts = dict->FindList("fonts")) {
    for (const Value& font : *fonts) {
      if (font.is_string() && !font.GetString().empty()) {
        config.fonts.push_back(font.GetString());
      }
    }
  }
  if (const DictValue* aliases = dict->FindDict("fontAliases")) {
    for (const auto [family, value] : *aliases) {
      const ListValue* list = value.GetIfList();
      if (family.empty() || !list) {
        continue;
      }
      FontAlias alias;
      alias.family = family;
      for (const Value& substitute : *list) {
        if (substitute.is_string() && !substitute.GetString().empty()) {
          alias.substitutes.push_back(substitute.GetString());
        }
      }
      if (!alias.substitutes.empty()) {
        config.font_aliases.push_back(std::move(alias));
      }
    }
  }
  config.timezone = StringOrEmpty(*dict, "timezone");
  config.webrtc_proxy_only = StringOrEmpty(*dict, "webRtcPolicy") == "proxyOnly";
  config.webrtc_public_ip = StringOrEmpty(*dict, "webRtcPublicIp");
  config.canvas_noise = dict->FindBool("canvasNoise").value_or(false);
  config.audio_noise = dict->FindBool("audioNoise").value_or(false);
  if (const DictValue* webgpu = dict->FindDict("webgpu")) {
    config.webgpu_vendor = StringOrEmpty(*webgpu, "vendor");
    config.webgpu_architecture = StringOrEmpty(*webgpu, "architecture");
  }
  if (const DictValue* mobile = dict->FindDict("mobile")) {
    const int width = mobile->FindInt("viewWidth").value_or(0);
    const int height = mobile->FindInt("viewHeight").value_or(0);
    const double scale = mobile->FindDouble("deviceScaleFactor").value_or(2.0);
    const int touch = mobile->FindInt("maxTouchPoints").value_or(5);
    if (width >= 200 && width <= 2000 && height >= 200 && height <= 4000 &&
        scale >= 1 && scale <= 5 && touch >= 1 && touch <= 10) {
      config.mobile = true;
      config.mobile_view_width = width;
      config.mobile_view_height = height;
      config.mobile_device_scale_factor = scale;
      config.mobile_max_touch_points = touch;
      config.mobile_pdf_viewer = mobile->FindBool("pdfViewer").value_or(false);
    }
  }
  if (const DictValue* caps = dict->FindDict("webglCaps")) {
    for (int version = 1; version <= 2; ++version) {
      const DictValue* one = caps->FindDict(version == 1 ? "1" : "2");
      if (!one) {
        continue;
      }
      Config::WebGLCaps& target = config.webgl_caps[version - 1];
      if (const DictValue* params = one->FindDict("p")) {
        for (const auto [name, value] : *params) {
          uint32_t pname = 0;
          if (!StringToUint(name, &pname)) {
            continue;
          }
          std::vector<double> numbers;
          if (value.is_int() || value.is_double()) {
            numbers.push_back(value.GetDouble());
          } else if (const ListValue* list = value.GetIfList()) {
            for (const Value& item : *list) {
              if (item.is_int() || item.is_double()) {
                numbers.push_back(item.GetDouble());
              }
            }
          }
          if (!numbers.empty() && numbers.size() <= 4) {
            target.params.emplace_back(pname, std::move(numbers));
          }
        }
      }
      if (const ListValue* extensions = one->FindList("e")) {
        target.has_extensions = true;
        for (const Value& extension : *extensions) {
          if (extension.is_string() && !extension.GetString().empty()) {
            target.extensions.push_back(extension.GetString());
          }
        }
      }
      if (const ListValue* precision = one->FindList("s");
          precision && precision->size() == 36) {
        for (const Value& item : *precision) {
          target.shader_precision.push_back(item.GetIfInt().value_or(0));
        }
      }
    }
  }
  config.vendor = StringOrEmpty(*dict, "vendor");
  config.safari_transport = StringOrEmpty(*dict, "transport") == "safari";
  config.client_hints = dict->FindBool("clientHints").value_or(true);
  config.chrome_object = dict->FindBool("chromeObject").value_or(true);
  if (const DictValue* hide = dict->FindDict("hide")) {
    for (const auto [interface_name, value] : *hide) {
      const ListValue* list = value.GetIfList();
      if (interface_name.empty() || !list) {
        continue;
      }
      Config::HiddenMembers hidden;
      hidden.interface_name = interface_name;
      for (const Value& member : *list) {
        if (member.is_string() && !member.GetString().empty()) {
          hidden.members.push_back(member.GetString());
        }
      }
      if (!hidden.members.empty()) {
        config.hidden_members.push_back(std::move(hidden));
      }
    }
  }
  if (const DictValue* geo = dict->FindDict("geolocation")) {
    const std::optional<double> latitude = geo->FindDouble("latitude");
    const std::optional<double> longitude = geo->FindDouble("longitude");
    if (latitude && longitude && *latitude >= -90 && *latitude <= 90 &&
        *longitude >= -180 && *longitude <= 180) {
      config.has_geolocation = true;
      config.geolocation_latitude = *latitude;
      config.geolocation_longitude = *longitude;
      const double accuracy = geo->FindDouble("accuracy").value_or(50.0);
      config.geolocation_accuracy = accuracy > 0 ? accuracy : 50.0;
    }
  }
  if (const DictValue* devices = dict->FindDict("mediaDevices")) {
    static const char* const kKinds[] = {"audioInput", "videoInput",
                                         "audioOutput"};
    config.has_media_devices = true;
    for (size_t kind = 0; kind < 3; ++kind) {
      const ListValue* list = devices->FindList(kKinds[kind]);
      if (!list) {
        continue;
      }
      for (const Value& item : *list) {
        const DictValue* entry = item.GetIfDict();
        if (!entry || config.media_devices[kind].size() >= 16) {
          continue;
        }
        Config::MediaDevice device;
        device.label = StringOrEmpty(*entry, "label");
        const std::string id = StringOrEmpty(*entry, "id");
        if (id == "default" || id == "communications") {
          device.id = id;
        }
        config.media_devices[kind].push_back(std::move(device));
      }
    }
  }
  if (const DictValue* battery = dict->FindDict("battery")) {
    const double level = battery->FindDouble("level").value_or(1.0);
    const double drain = battery->FindDouble("drainPerHour").value_or(0.0);
    if (level >= 0 && level <= 1 && drain >= 0 && drain <= 1) {
      config.has_battery = true;
      config.battery_charging = battery->FindBool("charging").value_or(true);
      config.battery_level = level;
      config.battery_drain_per_hour = drain;
      config.battery_at = battery->FindDouble("at").value_or(0.0);
    }
  }
  if (const DictValue* connection = dict->FindDict("connection")) {
    const std::string type = StringOrEmpty(*connection, "type");
    if (type == "wifi" || type == "cellular" || type == "ethernet" ||
        type == "bluetooth" || type == "other" || type == "unknown") {
      config.connection_type = type;
      const double max = connection->FindDouble("downlinkMax").value_or(0.0);
      config.connection_downlink_max = max > 0 && max < 100000 ? max : 0;
    }
  }
  if (const ListValue* voices = dict->FindList("voices")) {
    for (const Value& item : *voices) {
      const DictValue* entry = item.GetIfDict();
      if (!entry) {
        continue;
      }
      Voice voice;
      voice.name = StringOrEmpty(*entry, "name");
      voice.lang = StringOrEmpty(*entry, "lang");
      voice.local = entry->FindBool("local").value_or(true);
      voice.is_default = entry->FindBool("default").value_or(false);
      if (!voice.name.empty()) {
        config.voices.push_back(std::move(voice));
      }
    }
  }
  if (const std::string* value = dict->FindString("webglVendor")) {
    config.webgl_vendor = *value;
  }
  if (const std::string* value = dict->FindString("webglRenderer")) {
    config.webgl_renderer = *value;
  }
  return config;
}

}  // namespace

Voice::Voice() = default;
Voice::Voice(const Voice&) = default;
Voice& Voice::operator=(const Voice&) = default;
Voice::~Voice() = default;

FontAlias::FontAlias() = default;
FontAlias::FontAlias(const FontAlias&) = default;
FontAlias& FontAlias::operator=(const FontAlias&) = default;
FontAlias::~FontAlias() = default;

UaData::UaData() = default;
UaData::UaData(const UaData&) = default;
UaData& UaData::operator=(const UaData&) = default;
UaData::~UaData() = default;

Config::Config() = default;
Config::Config(const Config&) = default;
Config& Config::operator=(const Config&) = default;
Config::~Config() = default;

const Config& GetConfig() {
  static const NoDestructor<Config> config(LoadConfig());
  return *config;
}

}  // namespace base::proteus

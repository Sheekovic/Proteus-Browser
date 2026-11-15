// Copyright 2026 The Proteus Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#include "base/proteus/proteus_config.h"

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
  if (const std::string* value = dict->FindString("webglVendor")) {
    config.webgl_vendor = *value;
  }
  if (const std::string* value = dict->FindString("webglRenderer")) {
    config.webgl_renderer = *value;
  }
  return config;
}

}  // namespace

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

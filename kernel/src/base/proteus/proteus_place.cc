// Copyright 2026 The Proteus Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#include "base/proteus/proteus_place.h"

#include <atomic>
#include <tuple>
#include <utility>
#include <vector>

#include "base/base64.h"
#include "base/command_line.h"
#include "base/files/file.h"
#include "base/files/file_path.h"
#include "base/files/file_util.h"
#include "base/functional/bind.h"
#include "base/json/json_reader.h"
#include "base/json/json_writer.h"
#include "base/location.h"
#include "base/memory/scoped_refptr.h"
#include "base/no_destructor.h"
#include "base/proteus/proteus_config.h"
#include "base/strings/string_split.h"
#include "base/synchronization/lock.h"
#include "base/task/sequenced_task_runner.h"
#include "base/task/task_traits.h"
#include "base/task/thread_pool.h"
#include "base/time/time.h"
#include "base/values.h"

namespace base::proteus {

const char kPlaceSwitch[] = "proteus-place";

namespace {

// Ahead of a place sent where a time zone's name is sent. No time zone has a
// colon in its name.
constexpr std::string_view kMessagePrefix = "proteus-place:";
constexpr size_t kMaxPlaceBytes = 64 * 1024;
constexpr TimeDelta kLookEvery = Seconds(1);

std::atomic<bool> g_moved{false};

// The keys are the configuration's own (proteus_config.cc).
Place FromDict(const DictValue& dict) {
  Place place;
  if (const std::string* timezone = dict.FindString("timezone")) {
    place.timezone = *timezone;
  }
  if (const std::string* address = dict.FindString("webRtcPublicIp")) {
    place.webrtc_public_ip = *address;
  }
  if (const ListValue* languages = dict.FindList("languages")) {
    for (const Value& language : *languages) {
      if (!language.is_string() || language.GetString().empty()) {
        continue;
      }
      if (!place.accept_languages.empty()) {
        place.accept_languages += ",";
      }
      place.accept_languages += language.GetString();
    }
  }
  if (const DictValue* geo = dict.FindDict("geolocation")) {
    const std::optional<double> latitude = geo->FindDouble("latitude");
    const std::optional<double> longitude = geo->FindDouble("longitude");
    if (latitude && longitude && *latitude >= -90 && *latitude <= 90 &&
        *longitude >= -180 && *longitude <= 180) {
      place.has_geolocation = true;
      place.geolocation_latitude = *latitude;
      place.geolocation_longitude = *longitude;
      const double accuracy = geo->FindDouble("accuracy").value_or(50.0);
      place.geolocation_accuracy = accuracy > 0 ? accuracy : 50.0;
    }
  }
  return place;
}

std::string ToJson(const Place& place) {
  DictValue dict;
  dict.Set("timezone", place.timezone);
  dict.Set("webRtcPublicIp", place.webrtc_public_ip);
  ListValue languages;
  for (const std::string& language :
       SplitString(place.accept_languages, ",", TRIM_WHITESPACE,
                   SPLIT_WANT_NONEMPTY)) {
    languages.Append(language);
  }
  dict.Set("languages", std::move(languages));
  if (place.has_geolocation) {
    DictValue geo;
    geo.Set("latitude", place.geolocation_latitude);
    geo.Set("longitude", place.geolocation_longitude);
    geo.Set("accuracy", place.geolocation_accuracy);
    dict.Set("geolocation", std::move(geo));
  }
  return WriteJson(dict).value_or(std::string());
}

std::optional<Place> FromJson(std::string_view json) {
  std::optional<DictValue> dict = JSONReader::ReadDict(json, JSON_PARSE_RFC);
  if (!dict) {
    return std::nullopt;
  }
  return FromDict(*dict);
}

// The place this process starts in: the one it was given on its command line
// (a process started after a move), or else the configuration's.
Place InitialPlace() {
  if (CommandLine::InitializedForCurrentProcess()) {
    const CommandLine& command_line = *CommandLine::ForCurrentProcess();
    if (command_line.HasSwitch(kPlaceSwitch)) {
      std::string json;
      if (Base64Decode(command_line.GetSwitchValueASCII(kPlaceSwitch),
                       &json)) {
        if (std::optional<Place> given = FromJson(json)) {
          return *given;
        }
      }
    }
  }
  const Config& config = GetConfig();
  Place place;
  place.timezone = config.timezone;
  place.accept_languages = config.accept_languages;
  place.webrtc_public_ip = config.webrtc_public_ip;
  place.has_geolocation = config.has_geolocation;
  place.geolocation_latitude = config.geolocation_latitude;
  place.geolocation_longitude = config.geolocation_longitude;
  place.geolocation_accuracy = config.geolocation_accuracy;
  return place;
}

// The place now. A place that was replaced is never freed: a reference to it,
// or to one of its strings, may be in use on another thread. A profile moves a
// few times in a run at most.
std::atomic<const Place*>& Slot() {
  static std::atomic<const Place*> slot{new Place(InitialPlace())};
  return slot;
}

Lock& ObserversLock() {
  static NoDestructor<Lock> lock;
  return *lock;
}

std::vector<RepeatingClosure>& Observers() {
  static NoDestructor<std::vector<RepeatingClosure>> observers;
  return *observers;
}

// What tells one state of the file from the next.
struct FileState {
  bool there = false;
  Time modified;
  int64_t size = 0;

  bool operator==(const FileState& other) const {
    return there == other.there && modified == other.modified &&
           size == other.size;
  }
};

FileState StateOf(const FilePath& path) {
  File::Info info;
  if (!GetFileInfo(path, &info)) {
    return FileState();
  }
  return {true, info.last_modified, info.size};
}

// Looks at the file, takes it for the place if it has changed since `seen`, and
// looks again later. A file that cannot be read whole (it is being written) is
// read at the next look.
void Look(scoped_refptr<SequencedTaskRunner> runner,
          FilePath path,
          FileState seen) {
  const FileState now = StateOf(path);
  if (now.there && !(now == seen)) {
    std::string json;
    if (ReadFileToStringWithMaxSize(path, &json, kMaxPlaceBytes)) {
      if (std::optional<DictValue> dict =
              JSONReader::ReadDict(json, JSON_PARSE_RFC)) {
        SetPlace(FromDict(*dict));
        seen = now;
        // Whoever wrote the file learns from this that the browser has moved:
        // the file's "id" comes back in "place.taken" beside it.
        const std::string* id = dict->FindString("id");
        std::ignore = WriteFile(path.DirName().AppendASCII("place.taken"),
                                id ? *id : std::string());
      }
    }
  }
  runner->PostDelayedTask(FROM_HERE, BindOnce(&Look, runner, path, seen),
                          kLookEvery);
}

void LookFirst(scoped_refptr<SequencedTaskRunner> runner, FilePath path) {
  // What is there now was left by an earlier run.
  const FileState seen = StateOf(path);
  Look(std::move(runner), std::move(path), seen);
}

}  // namespace

Place::Place() = default;
Place::Place(const Place&) = default;
Place& Place::operator=(const Place&) = default;
Place::~Place() = default;

const Place& GetPlace() {
  return *Slot().load(std::memory_order_acquire);
}

void SetPlace(Place place) {
  Slot().store(new Place(std::move(place)), std::memory_order_release);
  g_moved.store(true, std::memory_order_release);
  std::vector<RepeatingClosure> observers;
  {
    AutoLock locker(ObserversLock());
    observers = Observers();
  }
  for (const RepeatingClosure& observer : observers) {
    observer.Run();
  }
}

bool PlaceHasMoved() {
  return g_moved.load(std::memory_order_acquire);
}

void AddPlaceObserver(RepeatingClosure observer) {
  AutoLock locker(ObserversLock());
  Observers().push_back(std::move(observer));
}

std::string PlaceMessage(const Place& place) {
  return std::string(kMessagePrefix) + ToJson(place);
}

std::optional<Place> PlaceFromMessage(std::string_view message) {
  if (!message.starts_with(kMessagePrefix)) {
    return std::nullopt;
  }
  return FromJson(message.substr(kMessagePrefix.size()));
}

std::string PlaceSwitchValue() {
  if (!PlaceHasMoved()) {
    return std::string();
  }
  return Base64Encode(ToJson(GetPlace()));
}

void WatchPlaceFile() {
  static std::atomic<bool> started{false};
  if (started.exchange(true) || !CommandLine::InitializedForCurrentProcess()) {
    return;
  }
  const CommandLine& command_line = *CommandLine::ForCurrentProcess();
  if (!command_line.HasSwitch(kConfigFileSwitch) || !GetConfig().active) {
    return;
  }
  FilePath path = command_line.GetSwitchValuePath(kConfigFileSwitch)
                      .DirName()
                      .AppendASCII("place.json");
  scoped_refptr<SequencedTaskRunner> runner =
      ThreadPool::CreateSequencedTaskRunner(
          {MayBlock(), TaskPriority::USER_VISIBLE,
           TaskShutdownBehavior::SKIP_ON_SHUTDOWN});
  runner->PostTask(FROM_HERE,
                   BindOnce(&LookFirst, runner, std::move(path)));
}

}  // namespace base::proteus

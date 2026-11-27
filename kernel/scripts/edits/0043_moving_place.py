"""Applies the in-place edits of patch 0043 to a Chromium checkout: a profile whose proxy
starts coming out somewhere else is moved there while it runs.

A profile behind a proxy is a browser of the place the proxy comes out in: its time
zone, its languages, its position and the address WebRTC shows are the exit's. They
were read once, when the browser started, so a proxy that changed its exit left the
browser in the old place until it was started again: New York's clock on an address
in Berlin.

The four now make up the profile's place (base/proteus/proteus_place.h), which can be
replaced while the browser runs. The manager writes the new place to "place.json"
beside the configuration; the browser process looks at that file, and
 - sends the place to every process that draws pages, down the pipe a change of the
   machine's time zone already travels (a laptop carried to another country is the
   same thing happening to a stock browser). There the clock changes, and every
   navigator, in pages and in workers, reads its languages again and gets the
   "languagechange" event a change of the browser's languages gives;
 - gives the network the new Accept-Language;
 - answers a page that asks for the position with the new one, and
 - starts every later process in the new place.
usage: 0043_moving_place.py <chromium-src-dir>"""
import pathlib
import sys

SRC = pathlib.Path(sys.argv[1])
BLINK = "third_party/blink/renderer/core/"
PLACE_INCLUDE = '#include "base/proteus/proteus_place.h"\n'
CONFIG_INCLUDE = '#include "base/proteus/proteus_config.h"\n'
TZ = BLINK + "timezone/timezone_controller.cc"
NAV_LANG = BLINK + "frame/navigator_language.cc"
MONITOR_H = "services/device/time_zone_monitor/time_zone_monitor.h"
MONITOR = "services/device/time_zone_monitor/time_zone_monitor.cc"
NET = "chrome/browser/net/profile_network_context_service.cc"
CLIENT = "chrome/browser/chrome_content_browser_client.cc"
PROVIDER = "services/device/geolocation/geolocation_provider_impl.cc"
PERMISSION = "services/device/public/cpp/geolocation/geolocation_system_permission_manager.cc"


def edit(rel, old, new):
    path = SRC / rel
    text = path.read_text(encoding="utf-8")
    if new in text:
        print("already applied:", rel)
        return
    if text.count(old) != 1:
        sys.exit("anchor not found exactly once in %s: %r" % (rel, old))
    path.write_text(text.replace(old, new), encoding="utf-8", newline="\n")
    print("edited:", rel)


# 1. The place is built with base.
edit(
    "base/BUILD.gn",
    '    "proteus/proteus_config.cc",\n    "proteus/proteus_config.h",\n',
    '    "proteus/proteus_config.cc",\n    "proteus/proteus_config.h",\n'
    '    "proteus/proteus_place.cc",\n    "proteus/proteus_place.h",\n',
)

# 2. The browser process sends a moved place to every process that listens for the
#    machine's time zone, and to each that starts listening later.
edit(
    MONITOR_H,
    '#include "base/threading/thread_checker.h"\n',
    '#include "base/memory/weak_ptr.h"\n#include "base/threading/thread_checker.h"\n',
)
edit(
    MONITOR_H,
    "  mojo::RemoteSet<device::mojom::TimeZoneMonitorClient> clients_;\n};\n",
    "  mojo::RemoteSet<device::mojom::TimeZoneMonitorClient> clients_;\n"
    "\n"
    "  // Proteus: sends a profile's place to every client once it has moved\n"
    "  // (patch 0043).\n"
    "  void ProteusPlaceMoved();\n"
    "\n"
    "  base::WeakPtrFactory<TimeZoneMonitor> proteus_weak_factory_{this};\n"
    "};\n",
)
edit(
    MONITOR,
    "TimeZoneMonitor::TimeZoneMonitor()\n"
    "    : timezone_(icu::TimeZone::createDefault()) {}\n",
    "TimeZoneMonitor::TimeZoneMonitor()\n"
    "    : timezone_(icu::TimeZone::createDefault()) {\n"
    "  // Proteus: see patch 0043.\n"
    "  base::proteus::AddPlaceObserver(base::BindPostTaskToCurrentDefault(\n"
    "      base::BindRepeating(&TimeZoneMonitor::ProteusPlaceMoved,\n"
    "                          proteus_weak_factory_.GetWeakPtr())));\n"
    "}\n"
    "\n"
    "void TimeZoneMonitor::ProteusPlaceMoved() {\n"
    "  DCHECK(thread_checker_.CalledOnValidThread());\n"
    "  const std::string message =\n"
    "      base::proteus::PlaceMessage(base::proteus::GetPlace());\n"
    "  for (auto& client : clients_) {\n"
    "    client->OnTimeZoneChange(message);\n"
    "  }\n"
    "}\n",
)
edit(
    MONITOR,
    "  clients_.Get(id)->OnTimeZoneChange(GetTimeZoneId(*timezone_));\n",
    "  clients_.Get(id)->OnTimeZoneChange(GetTimeZoneId(*timezone_));\n"
    "  // Proteus: a process that started while the place was being moved.\n"
    "  if (base::proteus::PlaceHasMoved()) {\n"
    "    clients_.Get(id)->OnTimeZoneChange(\n"
    "        base::proteus::PlaceMessage(base::proteus::GetPlace()));\n"
    "  }\n",
)
edit(
    MONITOR,
    '#include "base/logging.h"\n',
    '#include "base/functional/bind.h"\n'
    '#include "base/logging.h"\n',
)
edit(
    MONITOR,
    '#include "base/memory/ptr_util.h"\n',
    '#include "base/memory/ptr_util.h"\n' + PLACE_INCLUDE +
    '#include "base/task/bind_post_task.h"\n',
)

# 3. A process that draws pages takes the place it is sent.
edit(
    TZ,
    "void NotifyTimezoneChangeOnMainThread() {\n",
    "// Proteus: a profile's languages have moved with its place (patch 0043).\n"
    "// Every navigator of this process reads them again and is told, as when the\n"
    "// user changes the browser's languages.\n"
    "void ProteusLanguagesMovedOnWorkerThread(WorkerThread* worker_thread) {\n"
    "  DCHECK(worker_thread->IsCurrentThread());\n"
    "  if (auto* scope =\n"
    "          DynamicTo<WorkerGlobalScope>(worker_thread->GlobalScope())) {\n"
    "    scope->navigator()->NotifyUpdate();\n"
    "  }\n"
    "}\n"
    "\n"
    "void ProteusLanguagesMoved() {\n"
    "  // The event runs the page's script, which may close pages.\n"
    "  HeapVector<Member<LocalFrame>> frames;\n"
    "  for (const Page* page : Page::OrdinaryPages()) {\n"
    "    for (Frame* frame = page->MainFrame(); frame;\n"
    "         frame = frame->Tree().TraverseNext()) {\n"
    "      if (auto* local_frame = DynamicTo<LocalFrame>(frame)) {\n"
    "        frames.push_back(local_frame);\n"
    "      }\n"
    "    }\n"
    "  }\n"
    "  for (LocalFrame* frame : frames) {\n"
    "    if (LocalDOMWindow* window = frame->DomWindow()) {\n"
    "      window->AcceptLanguagesChanged();\n"
    "    }\n"
    "  }\n"
    "  WorkerThread::CallOnAllWorkerThreads(&ProteusLanguagesMovedOnWorkerThread,\n"
    "                                       TaskType::kInternalDefault);\n"
    "}\n"
    "\n"
    "void NotifyTimezoneChangeOnMainThread() {\n",
)
edit(
    TZ,
    "void TimeZoneController::OnTimeZoneChange(const String& timezone_id) {\n"
    "  DCHECK(IsMainThread());\n"
    "\n"
    "  base::AutoLock locker(instance().lock_);\n",
    "void TimeZoneController::OnTimeZoneChange(const String& timezone_id) {\n"
    "  DCHECK(IsMainThread());\n"
    "\n"
    "  // Proteus: not a time zone but a profile's new place (patch 0043).\n"
    "  if (std::optional<base::proteus::Place> place =\n"
    "          base::proteus::PlaceFromMessage(timezone_id.Utf8())) {\n"
    "    const String zone = String::FromUtf8(place->timezone);\n"
    "    const bool languages_moved = place->accept_languages !=\n"
    "                                 base::proteus::GetPlace().accept_languages;\n"
    "    base::proteus::SetPlace(std::move(*place));\n"
    "    if (!zone.empty()) {\n"
    "      base::AutoLock locker(instance().lock_);\n"
    "      if (!CanonicalEquals(instance().override_timezone_id_, zone) &&\n"
    "          SetIcuTimeZoneAndNotifyV8(zone)) {\n"
    "        instance().override_timezone_id_ = zone;\n"
    "      }\n"
    "    }\n"
    "    if (languages_moved) {\n"
    "      ProteusLanguagesMoved();\n"
    "    }\n"
    "    return;\n"
    "  }\n"
    "\n"
    "  base::AutoLock locker(instance().lock_);\n",
)
# A process started after a move starts in the new place.
edit(
    TZ,
    "  if (const std::string& forced = base::proteus::GetConfig().timezone;\n",
    "  if (const std::string& forced = base::proteus::GetPlace().timezone;\n",
)
edit(TZ, CONFIG_INCLUDE, CONFIG_INCLUDE + PLACE_INCLUDE)
edit(
    TZ,
    '#include "third_party/blink/renderer/core/workers/worker_backing_thread.h"\n',
    '#include "third_party/blink/renderer/core/workers/worker_backing_thread.h"\n'
    '#include "third_party/blink/renderer/core/workers/worker_global_scope.h"\n'
    '#include "third_party/blink/renderer/core/workers/worker_navigator.h"\n',
)
edit(
    TZ,
    '#include "third_party/blink/renderer/platform/runtime_enabled_features.h"\n',
    '#include "third_party/blink/renderer/platform/heap/collection_support/heap_vector.h"\n'
    '#include "third_party/blink/renderer/platform/heap/member.h"\n'
    '#include "third_party/blink/renderer/platform/runtime_enabled_features.h"\n',
)
edit(
    TZ,
    "#include <memory>\n#include <string>\n",
    "#include <memory>\n#include <optional>\n#include <string>\n#include <utility>\n",
)

# 4. navigator.languages is the place's.
edit(
    NAV_LANG,
    "    if (const std::string& forced =\n"
    "            base::proteus::GetConfig().accept_languages;\n",
    "    if (const std::string& forced =\n"
    "            base::proteus::GetPlace().accept_languages;\n",
)
edit(NAV_LANG, CONFIG_INCLUDE, CONFIG_INCLUDE + PLACE_INCLUDE)

# 5. The Accept-Language header is the place's, and is given to the network again
#    when the place moves. The profile's network service is made when the browser
#    starts, so it is also what starts the look-out for a new place.
edit(
    NET,
    "  if (const std::string& forced =\n"
    "          base::proteus::GetConfig().accept_languages;\n",
    "  if (const std::string& forced =\n"
    "          base::proteus::GetPlace().accept_languages;\n",
)
edit(
    NET,
    "  cookie_settings_ = CookieSettingsFactory::GetForProfile(profile);\n",
    "  cookie_settings_ = CookieSettingsFactory::GetForProfile(profile);\n"
    "  // Proteus: see patch 0043.\n"
    "  base::proteus::AddPlaceObserver(base::BindPostTaskToCurrentDefault(\n"
    "      base::BindRepeating(&ProfileNetworkContextService::UpdateAcceptLanguage,\n"
    "                          weak_factory_.GetWeakPtr())));\n"
    "  base::proteus::WatchPlaceFile();\n",
)
edit(
    NET,
    CONFIG_INCLUDE,
    CONFIG_INCLUDE + PLACE_INCLUDE + '#include "base/task/bind_post_task.h"\n',
)

# 6. A process started after a move is given the place it starts in.
edit(
    CLIENT,
    "  // Proteus: see patch 0042.\n"
    "  if (base::CommandLine::ForCurrentProcess()->HasSwitch(\"headless\") &&\n",
    "  // Proteus: see patch 0043.\n"
    "  if (const std::string place = base::proteus::PlaceSwitchValue();\n"
    "      !place.empty() &&\n"
    "      !command_line->HasSwitch(base::proteus::kPlaceSwitch)) {\n"
    "    command_line->AppendSwitchASCII(base::proteus::kPlaceSwitch, place);\n"
    "  }\n"
    "  // Proteus: see patch 0042.\n"
    "  if (base::CommandLine::ForCurrentProcess()->HasSwitch(\"headless\") &&\n",
)
edit(CLIENT, CONFIG_INCLUDE, CONFIG_INCLUDE + PLACE_INCLUDE)

# 7. The position is the place's.
edit(
    PROVIDER,
    "  const base::proteus::Config& config = base::proteus::GetConfig();\n"
    "  if (!config.has_geolocation) {\n"
    "    return nullptr;\n"
    "  }\n"
    "  auto position = mojom::Geoposition::New();\n"
    "  position->latitude = config.geolocation_latitude;\n"
    "  position->longitude = config.geolocation_longitude;\n"
    "  position->accuracy = config.geolocation_accuracy;\n",
    "  const base::proteus::Place& place = base::proteus::GetPlace();\n"
    "  if (!place.has_geolocation) {\n"
    "    return nullptr;\n"
    "  }\n"
    "  auto position = mojom::Geoposition::New();\n"
    "  position->latitude = place.geolocation_latitude;\n"
    "  position->longitude = place.geolocation_longitude;\n"
    "  position->accuracy = place.geolocation_accuracy;\n",
)
edit(PROVIDER, CONFIG_INCLUDE, CONFIG_INCLUDE + PLACE_INCLUDE)
edit(
    PERMISSION,
    "  if (base::proteus::GetConfig().has_geolocation) {\n",
    "  if (base::proteus::GetPlace().has_geolocation) {\n",
)
edit(PERMISSION, CONFIG_INCLUDE, CONFIG_INCLUDE + PLACE_INCLUDE)

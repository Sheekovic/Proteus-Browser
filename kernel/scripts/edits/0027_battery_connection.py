"""Applies the in-place edits of patch 0027 to a Chromium checkout: the battery and the
kind of network connection a page is told about come from the profile.
usage: 0027_battery_connection.py <chromium-src-dir>"""
import pathlib
import sys

SRC = pathlib.Path(sys.argv[1])
BATTERY_CC = "third_party/blink/renderer/modules/battery/battery_dispatcher.cc"
NETINFO_CC = "third_party/blink/renderer/modules/netinfo/network_information.cc"
FEATURES_CC = "content/child/runtime_features.cc"
CONFIG = '#include "base/proteus/proteus_config.h"\n'


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


# 1. navigator.getBattery(): the profile's battery. This machine's battery is still
#    watched, so that the page is answered at the moment it always is, but none of
#    what it says is passed on.
NEXT = '#include "services/device/public/mojom/battery_status.mojom-blink.h"\n'
edit(BATTERY_CC, NEXT, '#include <algorithm>\n\n' + CONFIG + '#include "base/time/time.h"\n' + NEXT)
edit(
    BATTERY_CC,
    "  QueryNextStatus();\n"
    "\n"
    "  DCHECK(battery_status);\n",
    "  QueryNextStatus();\n"
    "\n"
    "  DCHECK(battery_status);\n"
    "\n"
    "  // Proteus: the battery of the profile's device.\n"
    "  if (const base::proteus::Config& config = base::proteus::GetConfig();\n"
    "      config.has_battery) {\n"
    "    double level = config.battery_level;\n"
    "    if (!config.battery_charging && config.battery_at > 0) {\n"
    "      const double hours =\n"
    "          (base::Time::Now().InSecondsFSinceUnixEpoch() - config.battery_at) /\n"
    "          3600.0;\n"
    "      level -= config.battery_drain_per_hour * std::max(0.0, hours);\n"
    "    }\n"
    "    level = std::clamp(level, 0.05, 1.0);\n"
    "    // A full battery on a charger has finished charging; otherwise no browser\n"
    "    // can tell how long is left, which it reports as \"unknown\".\n"
    "    UpdateBatteryStatus(BatteryStatus(\n"
    "        config.battery_charging,\n"
    "        config.battery_charging && level >= 1 ? base::TimeDelta()\n"
    "                                              : base::TimeDelta::Max(),\n"
    "        base::TimeDelta::Max(), level));\n"
    "    return;\n"
    "  }\n",
)

# 2. navigator.connection.type and .downlinkMax exist on a phone...
NEXT = '#include "base/feature_list.h"\n'
edit(FEATURES_CC, '#include "base/command_line.h"\n' + NEXT,
     '#include "base/command_line.h"\n' + NEXT + CONFIG)
edit(
    FEATURES_CC,
    "  ResolveInvalidConfigurations();\n"
    "}\n"
    "\n"
    "}  // namespace content\n",
    "  // Proteus: a phone's browser also tells pages which kind of connection it is\n"
    "  // on (NetworkInformation.type, .downlinkMax and the typechange event).\n"
    "  if (!base::proteus::GetConfig().connection_type.empty()) {\n"
    "    WebRuntimeFeatures::EnableNetInfoDownlinkMax(true);\n"
    "  }\n"
    "\n"
    "  ResolveInvalidConfigurations();\n"
    "}\n"
    "\n"
    "}  // namespace content\n",
)

# 3. ...and say what the profile says.
NEXT = '#include "base/time/time.h"\n'
edit(NETINFO_CC, NEXT, '#include <limits>\n\n' + CONFIG + NEXT)
edit(
    NETINFO_CC,
    "V8ConnectionType NetworkInformation::type() const {\n",
    "V8ConnectionType NetworkInformation::type() const {\n"
    "  // Proteus: the connection of the profile's device.\n"
    "  if (const std::string& forced = base::proteus::GetConfig().connection_type;\n"
    "      !forced.empty()) {\n"
    "    if (const auto type = V8ConnectionType::Create(String::FromUtf8(forced))) {\n"
    "      return *type;\n"
    "    }\n"
    "  }\n"
    "\n",
)
edit(
    NETINFO_CC,
    "double NetworkInformation::downlinkMax() const {\n",
    "double NetworkInformation::downlinkMax() const {\n"
    "  // Proteus: the connection of the profile's device.\n"
    "  if (const base::proteus::Config& config = base::proteus::GetConfig();\n"
    "      !config.connection_type.empty()) {\n"
    "    return config.connection_downlink_max > 0\n"
    "               ? config.connection_downlink_max\n"
    "               : std::numeric_limits<double>::infinity();\n"
    "  }\n"
    "\n",
)

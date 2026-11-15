"""Applies the in-place edits of patch 0001 (config loader) to a Chromium checkout.
New files are copied from kernel/src by the caller; this only touches existing files.
usage: 0001_config_loader.py <chromium-src-dir>"""
import pathlib
import sys

SRC = pathlib.Path(sys.argv[1])


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


# 1. Compile the loader into //base.
edit(
    "base/BUILD.gn",
    '    "base64.cc",\n    "base64.h",\n',
    '    "base64.cc",\n    "base64.h",\n'
    '    "proteus/proteus_config.cc",\n    "proteus/proteus_config.h",\n',
)

# 2. Browser hands the configuration to every child process.
CCBC = "chrome/browser/chrome_content_browser_client.cc"
edit(
    CCBC,
    "  crash_keys::AppendStringAnnotationsCommandLineSwitch(command_line);\n"
    "#if BUILDFLAG(IS_MAC)\n",
    "  crash_keys::AppendStringAnnotationsCommandLineSwitch(command_line);\n"
    "  if (const base::proteus::Config& proteus_config =\n"
    "          base::proteus::GetConfig();\n"
    "      proteus_config.active &&\n"
    "      !command_line->HasSwitch(base::proteus::kConfigDataSwitch)) {\n"
    "    command_line->AppendSwitchASCII(base::proteus::kConfigDataSwitch,\n"
    "                                    proteus_config.serialized);\n"
    "  }\n"
    "#if BUILDFLAG(IS_MAC)\n",
)
edit(
    CCBC,
    '#include "base/path_service.h"\n',
    '#include "base/path_service.h"\n#include "base/proteus/proteus_config.h"\n',
)

# 3. navigator.hardwareConcurrency
edit(
    "third_party/blink/renderer/core/frame/navigator_concurrent_hardware.cc",
    '#include "base/system/sys_info.h"\n',
    '#include "base/proteus/proteus_config.h"\n#include "base/system/sys_info.h"\n',
)
edit(
    "third_party/blink/renderer/core/frame/navigator_concurrent_hardware.cc",
    "unsigned NavigatorConcurrentHardware::hardwareConcurrency() const {\n",
    "unsigned NavigatorConcurrentHardware::hardwareConcurrency() const {\n"
    "  if (const auto& forced =\n"
    "          base::proteus::GetConfig().hardware_concurrency) {\n"
    "    return static_cast<unsigned>(*forced);\n"
    "  }\n",
)

# 4. navigator.deviceMemory
edit(
    "third_party/blink/renderer/core/frame/navigator_device_memory.cc",
    "float NavigatorDeviceMemory::deviceMemory() const {\n",
    "float NavigatorDeviceMemory::deviceMemory() const {\n"
    "  if (const auto& forced = base::proteus::GetConfig().device_memory) {\n"
    "    return static_cast<float>(*forced);\n"
    "  }\n",
)
edit(
    "third_party/blink/renderer/core/frame/navigator_device_memory.cc",
    "\nnamespace blink {\n",
    '\n#include "base/proteus/proteus_config.h"\n\nnamespace blink {\n',
)

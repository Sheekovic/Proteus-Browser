"""Applies the in-place edits of patch 0006 (screen, languages, time zone) to a Chromium
checkout.
usage: 0006_screen_language_timezone.py <chromium-src-dir>"""
import pathlib
import sys

SRC = pathlib.Path(sys.argv[1])
BLINK = "third_party/blink/renderer/core/"
PROTEUS_INCLUDE = '#include "base/proteus/proteus_config.h"\n'


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


def include_after(rel, anchor, extra=PROTEUS_INCLUDE):
    edit(rel, anchor, anchor + extra)


# 1. window.screen ------------------------------------------------------------
SCREEN = BLINK + "frame/screen.cc"
for available, getter, field in (
    ("false", "height()", "height"),
    ("false", "width()", "width"),
    ("true", "height()", "avail_height"),
    ("true", "width()", "avail_width"),
):
    line = "  return GetRect(/*available=*/%s).%s;\n" % (available, getter)
    edit(
        SCREEN,
        line,
        "  if (const auto& forced = base::proteus::GetConfig().screen) {\n"
        "    return forced->%s;\n"
        "  }\n" % field + line,
    )
# A spoofed screen has no taskbar offset: the available area starts at 0,0.
for getter in ("x()", "y()"):
    line = "  return GetRect(/*available=*/true).%s;\n" % getter
    edit(
        SCREEN,
        line,
        "  if (base::proteus::GetConfig().screen) {\n"
        "    return 0;\n"
        "  }\n" + line,
    )
edit(
    SCREEN,
    "  return GetScreenInfo().depth == 0\n",
    "  if (const auto& forced = base::proteus::GetConfig().screen) {\n"
    "    return base::saturated_cast<unsigned>(forced->color_depth);\n"
    "  }\n"
    "  return GetScreenInfo().depth == 0\n",
)
include_after(SCREEN, '#include "base/numerics/safe_conversions.h"\n')

# 2. device-width / device-height media features --------------------------------
MEDIA = BLINK + "css/media_values.cc"
for dimension in ("width", "height"):
    line = "  int device_%s = screen_info.rect.%s();\n" % (dimension, dimension)
    edit(
        MEDIA,
        line,
        line
        + "  if (const auto& forced = base::proteus::GetConfig().screen) {\n"
        "    device_%s = forced->%s;\n"
        "  }\n" % (dimension, dimension),
    )
edit(
    MEDIA,
    '#include "third_party/blink/public/common/css/scripting.h"\n',
    PROTEUS_INCLUDE + '#include "third_party/blink/public/common/css/scripting.h"\n',
)

# 3. navigator.language / navigator.languages (window and workers) -------------
NAV_LANG = BLINK + "frame/navigator_language.cc"
edit(
    NAV_LANG,
    "    languages_ = ParseAndSanitize(GetAcceptLanguages());\n",
    "    if (const std::string& forced =\n"
    "            base::proteus::GetConfig().accept_languages;\n"
    "        !forced.empty()) {\n"
    "      languages_ =\n"
    "          ParseAndSanitize(String::FromUtf8(base::as_byte_span(forced)));\n"
    "    } else {\n"
    "      languages_ = ParseAndSanitize(GetAcceptLanguages());\n"
    "    }\n",
)
include_after(
    NAV_LANG,
    '#include "third_party/blink/renderer/core/frame/navigator_language.h"\n',
    "\n#include <string>\n\n"
    '#include "base/containers/span.h"\n' + PROTEUS_INCLUDE,
)

# 4. Accept-Language request header ---------------------------------------------
NET = "chrome/browser/net/profile_network_context_service.cc"
edit(
    NET,
    "std::string ProfileNetworkContextService::ComputeAcceptLanguage() const {\n",
    "std::string ProfileNetworkContextService::ComputeAcceptLanguage() const {\n"
    "  if (const std::string& forced =\n"
    "          base::proteus::GetConfig().accept_languages;\n"
    "      !forced.empty()) {\n"
    "    return ComputeAcceptLanguageFromPref(forced);\n"
    "  }\n",
)
include_after(NET, '#include "base/notreached.h"\n')

# 5. Time zone --------------------------------------------------------------------
# Installed as a time zone override when the renderer starts, before any script
# can observe the host zone; later host zone changes are then ignored.
TZ = BLINK + "timezone/timezone_controller.cc"
edit(
    TZ,
    "void TimeZoneController::Init() {\n",
    "void TimeZoneController::Init() {\n"
    "  if (const std::string& forced = base::proteus::GetConfig().timezone;\n"
    "      !forced.empty()) {\n"
    "    std::unique_ptr<icu::TimeZone> zone(icu::TimeZone::createTimeZone(\n"
    "        icu::UnicodeString::fromUTF8(forced)));\n"
    "    if (zone && *zone != icu::TimeZone::getUnknown()) {\n"
    "      base::AutoLock locker(instance().lock_);\n"
    "      icu::TimeZone::adoptDefault(zone.release());\n"
    "      instance().override_timezone_id_ =\n"
    "          String::FromUtf8(base::as_byte_span(forced));\n"
    "    }\n"
    "  }\n",
)
include_after(
    TZ,
    '#include "base/feature_list.h"\n',
    PROTEUS_INCLUDE,
)
edit(
    TZ,
    '#include "base/command_line.h"\n',
    "#include <memory>\n#include <string>\n\n"
    '#include "base/command_line.h"\n'
    '#include "base/containers/span.h"\n',
)

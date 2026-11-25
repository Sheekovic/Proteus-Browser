"""Applies the in-place edits of patch 0033 to a Chromium checkout: a profile with a
screen of its own has that one screen wherever a page can look.

Patches 0006 and 0029 made `screen` the profile's and `screen.isExtended` false. Two
ways were left to see the machine's screens, both found on a machine with three:
 - getScreenDetails(), once a page was allowed to ask, listed every screen of the
   machine with where it is and its name, which is the monitor's model: the same for
   every profile on that machine;
 - a window on a second screen is at a place its one screen does not have
   (screenX 4000 on a screen 1366 wide), and so are the clicks in it.
Now the list has the profile's one screen, at 0,0, primary, named as the profile
says; and the window is where it is on its own screen, kept inside the profile's,
with every pointer event moved by the same amount.
usage: 0033_one_screen.py <chromium-src-dir>"""
import pathlib
import sys

SRC = pathlib.Path(sys.argv[1])
BLINK = "third_party/blink/renderer/"
DETAILS = BLINK + "modules/screen_details/screen_details.cc"
DETAILED = BLINK + "modules/screen_details/screen_detailed.cc"
WINDOW_CC = BLINK + "core/frame/local_dom_window.cc"
WINDOW_H = BLINK + "core/frame/local_dom_window.h"
MOUSE = BLINK + "core/events/mouse_event.cc"


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


# 1. The list of screens is the one the window is on.
edit(
    DETAILS,
    "void ScreenDetails::UpdateScreenInfosImpl(LocalDOMWindow* window,\n"
    "                                          const display::ScreenInfos& new_infos,\n"
    "                                          bool dispatch_events) {\n",
    "void ScreenDetails::UpdateScreenInfosImpl(\n"
    "    LocalDOMWindow* window,\n"
    "    const display::ScreenInfos& real_infos,\n"
    "    bool dispatch_events) {\n"
    "  // Proteus: a profile with a screen of its own has that one screen.\n"
    "  const display::ScreenInfos new_infos =\n"
    "      base::proteus::GetConfig().screen && !real_infos.screen_infos.empty()\n"
    "          ? display::ScreenInfos(real_infos.current())\n"
    "          : real_infos;\n",
)
edit(
    DETAILS,
    '#include "third_party/blink/renderer/core/dom/events/event.h"\n',
    '#include "base/proteus/proteus_config.h"\n'
    '#include "third_party/blink/renderer/core/dom/events/event.h"\n',
)

# 2. What that screen says of itself.
for name, real, forced in (
    ("int ScreenDetailed::left() const", "GetRect(/*available=*/false).x()", "0"),
    ("int ScreenDetailed::top() const", "GetRect(/*available=*/false).y()", "0"),
    ("bool ScreenDetailed::isPrimary() const", "GetScreenInfo().is_primary", "true"),
    ("bool ScreenDetailed::isInternal() const", "GetScreenInfo().is_internal",
     "base::proteus::GetConfig().screen->internal"),
):
    edit(
        DETAILED,
        "%s {\n  if (!DomWindow())\n    return %s;\n  return %s;\n}\n"
        % (name, "false" if name.startswith("bool") else "0", real),
        "%s {\n  if (!DomWindow())\n    return %s;\n"
        "  if (base::proteus::GetConfig().screen) {\n    return %s;\n  }\n"
        "  return %s;\n}\n"
        % (name, "false" if name.startswith("bool") else "0", forced, real),
    )
edit(
    DETAILED,
    "String ScreenDetailed::label() const {\n"
    "  if (!DomWindow())\n"
    "    return String();\n"
    "  return String::FromUtf8(GetScreenInfo().label);\n",
    "String ScreenDetailed::label() const {\n"
    "  if (!DomWindow())\n"
    "    return String();\n"
    "  // Proteus: the machine's is its monitor's model, the same in every profile.\n"
    "  if (const auto& forced = base::proteus::GetConfig().screen) {\n"
    "    return String::FromUtf8(forced->label);\n"
    "  }\n"
    "  return String::FromUtf8(GetScreenInfo().label);\n",
)
edit(
    DETAILED,
    '#include "base/numerics/safe_conversions.h"\n',
    '#include "base/numerics/safe_conversions.h"\n'
    '#include "base/proteus/proteus_config.h"\n',
)

# 3. Where the window is: on its own screen, inside the profile's.
edit(
    WINDOW_H,
    "  int screenX() const;\n  int screenY() const;\n",
    "  int screenX() const;\n  int screenY() const;\n"
    "  // Proteus: how far the place a page is told lies from the real one, for a\n"
    "  // profile with a screen of its own (see local_dom_window.cc).\n"
    "  gfx::Vector2d ProteusScreenShift() const;\n",
)
edit(
    WINDOW_CC,
    "int LocalDOMWindow::screenX() const {\n",
    "// Proteus: a profile's screen is one screen that starts at 0,0. The window is\n"
    "// told to be where it is on the machine's screen it is on, kept inside the\n"
    "// profile's screen as far as its size allows; this is the difference from\n"
    "// where it really is, which every position on the screen is moved by.\n"
    "gfx::Vector2d LocalDOMWindow::ProteusScreenShift() const {\n"
    "  const auto& forced = base::proteus::GetConfig().screen;\n"
    "  LocalFrame* frame = GetFrame();\n"
    "  if (!forced || !frame || !frame->GetPage()) {\n"
    "    return gfx::Vector2d();\n"
    "  }\n"
    "  ChromeClient& chrome_client = frame->GetPage()->GetChromeClient();\n"
    "  const gfx::Rect window = chrome_client.RootWindowRect(*frame);\n"
    "  const gfx::Rect screen = chrome_client.GetScreenInfo(*frame).rect;\n"
    "  const int x = std::clamp(window.x() - screen.x(), 0,\n"
    "                           std::max(0, forced->width - window.width()));\n"
    "  const int y = std::clamp(window.y() - screen.y(), 0,\n"
    "                           std::max(0, forced->height - window.height()));\n"
    "  return gfx::Vector2d(window.x() - x, window.y() - y);\n"
    "}\n"
    "\n"
    "int LocalDOMWindow::screenX() const {\n",
)
edit(
    WINDOW_CC,
    "  int screenX = chrome_client.RootWindowRect(*frame).x();\n",
    "  int screenX =\n"
    "      chrome_client.RootWindowRect(*frame).x() - ProteusScreenShift().x();\n",
)
edit(
    WINDOW_CC,
    "  int screenY = chrome_client.RootWindowRect(*frame).y();\n",
    "  int screenY =\n"
    "      chrome_client.RootWindowRect(*frame).y() - ProteusScreenShift().y();\n",
)

# 4. And where the pointer is.
edit(
    MOUSE,
    "  initializer->setScreenX(screen_point.x());\n"
    "  initializer->setScreenY(screen_point.y());\n",
    "  if (dom_window) {\n"
    "    // Proteus: see LocalDOMWindow::ProteusScreenShift().\n"
    "    screen_point -= gfx::Vector2dF(dom_window->ProteusScreenShift());\n"
    "  }\n"
    "  initializer->setScreenX(screen_point.x());\n"
    "  initializer->setScreenY(screen_point.y());\n",
)

# 5. What those need.
edit(
    WINDOW_H,
    '#include "third_party/blink/renderer/core/core_export.h"\n',
    '#include "third_party/blink/renderer/core/core_export.h"\n'
    '#include "ui/gfx/geometry/vector2d.h"\n',
)
edit(
    WINDOW_CC,
    "#include <memory>\n#include <optional>\n#include <utility>\n\n"
    '#include "base/command_line.h"\n',
    "#include <algorithm>\n#include <memory>\n#include <optional>\n#include <utility>\n\n"
    '#include "base/command_line.h"\n'
    '#include "base/proteus/proteus_config.h"\n',
)
edit(
    MOUSE,
    '#include "third_party/blink/public/common/input/web_pointer_properties.h"\n',
    '#include "third_party/blink/public/common/input/web_pointer_properties.h"\n'
    '#include "ui/gfx/geometry/vector2d_f.h"\n',
)

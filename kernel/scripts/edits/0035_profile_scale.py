"""Applies the in-place edits of patch 0035 to a Chromium checkout: a page is laid out at
the scale of the profile's system while the window is drawn at the machine's.

A profile's screen comes with the pixel ratio it was read at (1536 by 864 is a 1920
by 1080 panel at 125%). Until now the whole browser was started at that ratio, which
is right for the page and wrong for the person: on a monitor at another scale the
window and its bars were larger or smaller than every other program.

Pretending the ratio to the page alone (what DevTools' device mode does) is found at
once: devicePixelRatio says 1.25 while borders, positions and scrollbars still snap
to the machine's pixels. So the page is really laid out at the profile's ratio: the
layout zoom, which is the display's scale times the user's zoom, takes the profile's
ratio for the display's. A device pixel is still a device pixel, so nothing is
resampled; a page at 125% on a monitor at 150% is drawn as that page is drawn on a
125% monitor of the same pixels, and has more room.

What is measured in the machine's units is then turned into the profile's: lengths
that are so many units whatever the page (a scrollbar's thickness, a step of the
wheel), the window's size and place and the pointer's place on the screen, which a
page reads in CSS pixels, and the window's first size, which the manager gives in the
profile's.
usage: 0035_profile_scale.py <chromium-src-dir>"""
import pathlib
import sys

SRC = pathlib.Path(sys.argv[1])
BLINK = "third_party/blink/renderer/"
VIEW_H = BLINK + "core/exported/web_view_impl.h"
WINDOW_CC = BLINK + "core/frame/local_dom_window.cc"
WINDOW_H = BLINK + "core/frame/local_dom_window.h"
FRAME_CC = BLINK + "core/frame/local_frame.cc"
FRAME_H = BLINK + "core/frame/local_frame.h"
CLIENT = BLINK + "core/page/chrome_client_impl.cc"
MOUSE = BLINK + "core/events/mouse_event.cc"
WHEEL = BLINK + "core/events/wheel_event.cc"
STATE = "chrome/browser/ui/browser_window_state.cc"


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


# 1. The scale a page is laid out at.
edit(
    VIEW_H,
    "    return compositor_device_scale_factor_override_\n"
    "               ? compositor_device_scale_factor_override_\n"
    "               : zoom_factor_for_device_scale_factor_;\n",
    "    if (compositor_device_scale_factor_override_) {\n"
    "      return compositor_device_scale_factor_override_;\n"
    "    }\n"
    "    // Proteus: the scale of the profile's system stands for the machine's.\n"
    "    if (const auto& screen = base::proteus::GetConfig().screen;\n"
    "        screen && screen->pixel_ratio > 0) {\n"
    "      return static_cast<float>(screen->pixel_ratio *\n"
    "                                zoom_factor_for_text_scale_multiplier_);\n"
    "    }\n"
    "    return zoom_factor_for_device_scale_factor_;\n",
)
edit(
    VIEW_H,
    '#include "base/memory/scoped_refptr.h"\n',
    '#include "base/memory/scoped_refptr.h"\n#include "base/proteus/proteus_config.h"\n',
)

# 2. A length given in the machine's units that is so many CSS pixels whatever the
#    page: a scrollbar's thickness, a step of the wheel, the caret, the arrow of a
#    list. The code asks for all of them in one place, which also serves the few
#    callers that place something on the screen; those are given the machine's scale
#    by name below.
edit(
    CLIENT,
    "  if (auto* widget = frame->GetWidgetForLocalRoot()) {\n"
    "    return widget->DIPsToBlinkSpace(scalar_value);\n"
    "  }\n"
    "  return scalar_value;\n",
    "  // Proteus: at the scale pages are laid out at.\n"
    "  if (const auto& screen = base::proteus::GetConfig().screen;\n"
    "      screen && screen->pixel_ratio > 0) {\n"
    "    return scalar_value * static_cast<float>(screen->pixel_ratio);\n"
    "  }\n"
    "  if (auto* widget = frame->GetWidgetForLocalRoot()) {\n"
    "    return widget->DIPsToBlinkSpace(scalar_value);\n"
    "  }\n"
    "  return scalar_value;\n",
)
edit(
    CLIENT,
    '#include "base/debug/alias.h"\n',
    '#include "base/debug/alias.h"\n#include "base/proteus/proteus_config.h"\n',
)
# (An earlier revision declared this const, which the widget's getter is not.)
for _rel in (FRAME_H, FRAME_CC):
    _path = SRC / _rel
    _text = _path.read_text(encoding="utf-8")
    if "ProteusMachineScale() const" in _text:
        _path.write_text(
            _text.replace("ProteusMachineScale() const", "ProteusMachineScale()"),
            encoding="utf-8",
            newline="\n",
        )
        print("corrected:", _rel)
edit(
    FRAME_H,
    "  float LayoutZoomFactor() const { return layout_zoom_factor_; }\n",
    "  float LayoutZoomFactor() const { return layout_zoom_factor_; }\n"
    "  // Proteus: device pixels to one of the machine's units, for what is placed\n"
    "  // on the machine's screen (see patch 0035).\n"
    "  float ProteusMachineScale();\n",
)
edit(
    FRAME_CC,
    "double LocalFrame::DevicePixelRatio() const {\n",
    "float LocalFrame::ProteusMachineScale() {\n"
    "  FrameWidget* widget = GetWidgetForLocalRoot();\n"
    "  return widget ? widget->DIPsToBlinkSpace(1.0f) : 1.0f;\n"
    "}\n"
    "\n"
    "double LocalFrame::DevicePixelRatio() const {\n",
)
edit(
    BLINK + "core/frame/find_in_page.cc",
    "    device_scale_factor =\n"
    "        local_frame->GetPage()->GetChromeClient().WindowToViewportScalar(\n"
    "            local_frame, 1.0f);\n",
    "    device_scale_factor = local_frame->ProteusMachineScale();\n",
)
edit(
    BLINK + "core/frame/local_frame_mojo_handler.cc",
    "  const float window_to_viewport_factor =\n"
    "      page->GetChromeClient().WindowToViewportScalar(&local_frame_root, 1.0f);\n",
    "  const float window_to_viewport_factor =\n"
    "      local_frame_root.ProteusMachineScale();\n",
)
edit(
    FRAME_CC,
    "  const float window_to_viewport_factor =\n"
    "      GetPage()->GetChromeClient().WindowToViewportScalar(&local_frame_root,\n"
    "                                                          1.0f);\n",
    "  const float window_to_viewport_factor =\n"
    "      local_frame_root.ProteusMachineScale();\n",
)
edit(
    BLINK + "modules/accessibility/ax_object.cc",
    "        float scale_factor =\n"
    "            view->GetPage()->GetChromeClient().WindowToViewportScalar(\n"
    "                layout_object->GetFrame(), 1.0f);\n",
    "        float scale_factor =\n"
    "            layout_object->GetFrame()->ProteusMachineScale();\n",
)

# 3. The wheel: a step is so many of the machine's units, and so many CSS pixels on
#    a machine at the profile's scale.
edit(
    WHEEL,
    "      delta_x_(-event.DeltaXInRootFrame() / window.devicePixelRatio()),\n"
    "      delta_y_(-event.DeltaYInRootFrame() / window.devicePixelRatio()),\n",
    "      delta_x_(-event.DeltaXInRootFrame() / window.devicePixelRatio() /\n"
    "               window.ProteusScreenScale()),\n"
    "      delta_y_(-event.DeltaYInRootFrame() / window.devicePixelRatio() /\n"
    "               window.ProteusScreenScale()),\n",
)

# 4. The window and the pointer on the screen, in the profile's CSS pixels. This
#    takes the place of patch 0033's shift, which moved them without scaling.
#    (An earlier revision scaled the window's bars with the page.)
OLD_POINT = (
    "  const float scale = ProteusScreenScale();\n"
    "  const float x = std::clamp(\n"
    "      (window.x() - screen.x()) * scale, 0.f,\n"
    "      std::max(0.f, forced->width - window.width() * scale));\n"
    "  const float y = std::clamp(\n"
    "      (window.y() - screen.y()) * scale, 0.f,\n"
    "      std::max(0.f, forced->height - window.height() * scale));\n"
    "  return gfx::PointF(x + (real.x() - window.x()) * scale,\n"
    "                     y + (real.y() - window.y()) * scale);\n"
    "}\n"
)
NEW_POINT = (
    "  const float scale = ProteusScreenScale();\n"
    "  const gfx::SizeF outer = ProteusOuterSize();\n"
    "  const float x =\n"
    "      std::clamp((window.x() - screen.x()) * scale, 0.f,\n"
    "                 std::max(0.f, forced->width - outer.width()));\n"
    "  const float y =\n"
    "      std::clamp((window.y() - screen.y()) * scale, 0.f,\n"
    "                 std::max(0.f, forced->height - outer.height()));\n"
    "  // The window's bars are as thick as they are; the page begins after them\n"
    "  // and is measured in its own pixels.\n"
    "  const gfx::Rect view = ProteusViewOnScreen(frame);\n"
    "  if (view.IsEmpty()) {\n"
    "    return gfx::PointF(x + (real.x() - window.x()) * scale,\n"
    "                       y + (real.y() - window.y()) * scale);\n"
    "  }\n"
    "  // Along one axis, from the window's edge: the machine's units up to the\n"
    "  // page's area, the page's pixels inside it, the machine's again after it.\n"
    "  const auto along = [scale](float place, float edge, float start,\n"
    "                             float size) {\n"
    "    const float inside = std::clamp(place - start, 0.f, size);\n"
    "    return (start - edge) + inside * scale + (place - start - inside);\n"
    "  };\n"
    "  return gfx::PointF(\n"
    "      x + along(real.x(), window.x(), view.x(), view.width()),\n"
    "      y + along(real.y(), window.y(), view.y(), view.height()));\n"
    "}\n"
    "\n"
    "// Proteus: the window's size as a page reads it: its bars, which are drawn at\n"
    "// the machine's scale and are as many units there as on any machine, around\n"
    "// the page's area in the page's own pixels.\n"
    "gfx::SizeF LocalDOMWindow::ProteusOuterSize() const {\n"
    "  LocalFrame* frame = GetFrame();\n"
    "  if (!frame || !frame->GetPage()) {\n"
    "    return gfx::SizeF();\n"
    "  }\n"
    "  const gfx::Rect window =\n"
    "      frame->GetPage()->GetChromeClient().RootWindowRect(*frame);\n"
    "  const float scale = ProteusScreenScale();\n"
    "  const gfx::Rect view = ProteusViewOnScreen(frame);\n"
    "  if (scale == 1 || view.IsEmpty()) {\n"
    "    return gfx::SizeF(window.width() * scale, window.height() * scale);\n"
    "  }\n"
    "  // The page's area, rounded as its inner size is.\n"
    "  const gfx::Size area = frame->LocalFrameRoot().View()->Size();\n"
    "  const float ratio = static_cast<float>(\n"
    "      base::proteus::GetConfig().screen->pixel_ratio);\n"
    "  return gfx::SizeF(\n"
    "      window.width() - view.width() +\n"
    "          AdjustForAbsoluteZoom::AdjustInt(area.width(), ratio),\n"
    "      window.height() - view.height() +\n"
    "          AdjustForAbsoluteZoom::AdjustInt(area.height(), ratio));\n"
    "}\n"
)
# (An earlier revision rounded the page's area its own way: a pixel off.)
_OWN_ROUNDING = (
    "  return gfx::SizeF(window.width() - view.width() + view.width() * scale,\n"
    "                    window.height() - view.height() + view.height() * scale);\n"
    "}\n"
)
_window = SRC / WINDOW_CC
_text = _window.read_text(encoding="utf-8")
if OLD_POINT in _text and NEW_POINT not in _text:
    _window.write_text(_text.replace(OLD_POINT, NEW_POINT), encoding="utf-8", newline="\n")
    print("corrected the place on the screen")
# (And one scaled the window's bars when placing a point above the page.)
_BARS_SCALED = (
    "  return gfx::PointF(\n"
    "      x + (view.x() - window.x()) + (real.x() - view.x()) * scale,\n"
    "      y + (view.y() - window.y()) + (real.y() - view.y()) * scale);\n"
    "}\n"
)
_text = _window.read_text(encoding="utf-8")
_AXIS_START = NEW_POINT.index("  // Along one axis")
_AXIS = NEW_POINT[_AXIS_START : NEW_POINT.index("}\n", NEW_POINT.index("view.height()));")) + 2]
if _BARS_SCALED in _text:
    _window.write_text(_text.replace(_BARS_SCALED, _AXIS), encoding="utf-8", newline="\n")
    print("corrected a point above the page")
# (And one, making that correction, left the function without its end.)
_ENDLESS = (
    "                       y + (real.y() - window.y()) * scale);\n"
    "  }\n"
    "\n"
    "// Proteus: the window's size as a page reads it"
)
_text = _window.read_text(encoding="utf-8")
if _ENDLESS in _text:
    _window.write_text(
        _text.replace(_ENDLESS, _ENDLESS.replace("  }\n\n//", "  }\n" + _AXIS + "\n//")),
        encoding="utf-8",
        newline="\n",
    )
    print("gave the function its end back")
_text = _window.read_text(encoding="utf-8")
if _OWN_ROUNDING in _text:
    _window.write_text(
        _text.replace(_OWN_ROUNDING, NEW_POINT[NEW_POINT.index("  // The page's area, rounded") :]),
        encoding="utf-8",
        newline="\n",
    )
    print("corrected the rounding of the outer size")
_text = _window.read_text(encoding="utf-8")
for _dimension in ("height", "width"):
    _old = (
        "  int %s = static_cast<int>(lroundf(\n"
        "      chrome_client.RootWindowRect(*frame).%s() * ProteusScreenScale()));\n"
        % (_dimension, _dimension)
    )
    _new = "  int %s = static_cast<int>(lroundf(ProteusOuterSize().%s()));\n" % (
        _dimension,
        _dimension,
    )
    if _old in _text:
        _text = _text.replace(_old, _new)
        print("corrected the outer", _dimension)
_window.write_text(_text, encoding="utf-8", newline="\n")
_header = SRC / WINDOW_H
_text = _header.read_text(encoding="utf-8")
if "ProteusScreenPoint" in _text and "ProteusOuterSize" not in _text:
    _header.write_text(
        _text.replace(
            "  gfx::PointF ProteusScreenPoint(const gfx::PointF& real) const;\n",
            "  gfx::PointF ProteusScreenPoint(const gfx::PointF& real) const;\n"
            "  gfx::SizeF ProteusOuterSize() const;\n",
        ).replace(
            '#include "ui/gfx/geometry/point_f.h"\n',
            '#include "ui/gfx/geometry/point_f.h"\n#include "ui/gfx/geometry/size_f.h"\n',
        ),
        encoding="utf-8",
        newline="\n",
    )
    print("corrected the declarations")

edit(
    WINDOW_H,
    "  gfx::Vector2d ProteusScreenShift() const;\n",
    "  gfx::Vector2d ProteusScreenShift() const;\n"
    "  // Proteus: how many CSS pixels of the profile's system one of the machine's\n"
    "  // units is, and a place on the machine's screen and the window's size as a\n"
    "  // page of the profile reads them.\n"
    "  float ProteusScreenScale() const;\n"
    "  gfx::PointF ProteusScreenPoint(const gfx::PointF& real) const;\n"
    "  gfx::SizeF ProteusOuterSize() const;\n",
) if "ProteusScreenScale" not in (SRC / WINDOW_H).read_text(encoding="utf-8") else print(
    "already applied:", WINDOW_H
)
edit(
    WINDOW_H,
    '#include "ui/gfx/geometry/vector2d.h"\n',
    '#include "ui/gfx/geometry/point_f.h"\n'
    '#include "ui/gfx/geometry/size_f.h"\n'
    '#include "ui/gfx/geometry/vector2d.h"\n',
) if "point_f.h" not in (SRC / WINDOW_H).read_text(encoding="utf-8") else print(
    "already applied:", WINDOW_H
)
VIEW_ON_SCREEN = (
    "// Proteus: where the page's area is on the machine's screen, in the machine's\n"
    "// units; empty for a frame whose page's main frame is in another process.\n"
    "static gfx::Rect ProteusViewOnScreen(LocalFrame* frame) {\n"
    "  LocalFrame& root = frame->LocalFrameRoot();\n"
    "  if (!root.IsOutermostMainFrame() || !root.View() || !frame->GetPage()) {\n"
    "    return gfx::Rect();\n"
    "  }\n"
    "  return frame->GetPage()->GetChromeClient().LocalRootToScreenDIPs(\n"
    "      gfx::Rect(root.View()->Size()), root.View());\n"
    "}\n"
    "\n"
)
SCALE_HEAD = (
    "// Proteus: sizes and places on the screen reach a page in the machine's units.\n"
)
if "ProteusScreenScale() const {" not in (SRC / WINDOW_CC).read_text(encoding="utf-8"):
    edit(
        WINDOW_CC,
        "int LocalDOMWindow::screenX() const {\n",
        VIEW_ON_SCREEN
        + SCALE_HEAD
        + "// A profile with a scale of its own has pages laid out at that scale, so one\n"
        "// of the machine's units is this many of the page's CSS pixels.\n"
        "float LocalDOMWindow::ProteusScreenScale() const {\n"
        "  const auto& forced = base::proteus::GetConfig().screen;\n"
        "  LocalFrame* frame = GetFrame();\n"
        "  if (!forced || forced->pixel_ratio <= 0 || !frame || !frame->GetPage()) {\n"
        "    return 1;\n"
        "  }\n"
        "  const float real = frame->GetPage()\n"
        "                         ->GetChromeClient()\n"
        "                         .GetScreenInfo(*frame)\n"
        "                         .device_scale_factor;\n"
        "  return real > 0 ? real / static_cast<float>(forced->pixel_ratio) : 1;\n"
        "}\n"
        "\n"
        "// Proteus: the window is told to be where it is on the machine's screen it is\n"
        "// on, in the profile's units and kept inside the profile's screen as far as\n"
        "// its size allows; every other place on the screen keeps its distance to it.\n"
        "gfx::PointF LocalDOMWindow::ProteusScreenPoint(const gfx::PointF& real) const {\n"
        "  const auto& forced = base::proteus::GetConfig().screen;\n"
        "  LocalFrame* frame = GetFrame();\n"
        "  if (!forced || !frame || !frame->GetPage()) {\n"
        "    return real;\n"
        "  }\n"
        "  ChromeClient& chrome_client = frame->GetPage()->GetChromeClient();\n"
        "  const gfx::Rect window = chrome_client.RootWindowRect(*frame);\n"
        "  const gfx::Rect screen = chrome_client.GetScreenInfo(*frame).rect;\n"
        + NEW_POINT
        + "\n"
        "int LocalDOMWindow::screenX() const {\n",
    )
else:
    edit(WINDOW_CC, SCALE_HEAD, VIEW_ON_SCREEN + SCALE_HEAD)
edit(
    WINDOW_CC,
    "  int screenX =\n"
    "      chrome_client.RootWindowRect(*frame).x() - ProteusScreenShift().x();\n",
    "  int screenX = static_cast<int>(lroundf(\n"
    "      ProteusScreenPoint(\n"
    "          gfx::PointF(chrome_client.RootWindowRect(*frame).origin()))\n"
    "          .x()));\n",
)
edit(
    WINDOW_CC,
    "  int screenY =\n"
    "      chrome_client.RootWindowRect(*frame).y() - ProteusScreenShift().y();\n",
    "  int screenY = static_cast<int>(lroundf(\n"
    "      ProteusScreenPoint(\n"
    "          gfx::PointF(chrome_client.RootWindowRect(*frame).origin()))\n"
    "          .y()));\n",
)
if "lroundf(ProteusOuterSize().height())" not in (SRC / WINDOW_CC).read_text(encoding="utf-8"):
    edit(
        WINDOW_CC,
        "  int height = chrome_client.RootWindowRect(*frame).height();\n",
        "  int height = static_cast<int>(lroundf(ProteusOuterSize().height()));\n",
    )
    edit(
        WINDOW_CC,
        "  int width = chrome_client.RootWindowRect(*frame).width();\n",
        "  int width = static_cast<int>(lroundf(ProteusOuterSize().width()));\n",
    )
edit(
    MOUSE,
    "    // Proteus: see LocalDOMWindow::ProteusScreenShift().\n"
    "    screen_point -= gfx::Vector2dF(dom_window->ProteusScreenShift());\n",
    "    // Proteus: see LocalDOMWindow::ProteusScreenPoint().\n"
    "    screen_point = dom_window->ProteusScreenPoint(screen_point);\n",
)

# 4b. On Linux, how letters are drawn depends on the scale (above 1 they are placed
#     between pixels and not fitted to them), which moves lines by a device pixel.
#     Only where a scale is given: a question without one is answered at 1 on any
#     machine, which is how the letters in a form's fields are drawn.
_FONTS = SRC / "ui/gfx/font_render_params_linux.cc"
_ASKED = (
    "  if (actual_query.device_scale_factor == 0)\n"
    "    actual_query.device_scale_factor = device_scale_factor_;\n"
)
_ALWAYS = (
    "  // Proteus: letters are drawn as on a machine at the profile's scale.\n"
    "  if (const auto& proteus_screen = base::proteus::GetConfig().screen;\n"
    "      proteus_screen && proteus_screen->pixel_ratio > 0) {\n"
    "    actual_query.device_scale_factor =\n"
    "        static_cast<float>(proteus_screen->pixel_ratio);\n"
    "  }\n"
)
_text = _FONTS.read_text(encoding="utf-8")
if _ASKED + _ALWAYS in _text:  # an earlier revision answered every question so
    _FONTS.write_text(_text.replace(_ASKED + _ALWAYS, _ASKED), encoding="utf-8", newline="\n")
    print("took back the scale for questions without one")
edit(
    "ui/gfx/font_render_params_linux.cc",
    _ASKED,
    "  // Proteus: letters are drawn as on a machine at the profile's scale.\n"
    "  if (const auto& proteus_screen = base::proteus::GetConfig().screen;\n"
    "      actual_query.device_scale_factor != 0 && proteus_screen &&\n"
    "      proteus_screen->pixel_ratio > 0) {\n"
    "    actual_query.device_scale_factor =\n"
    "        static_cast<float>(proteus_screen->pixel_ratio);\n"
    "  }\n" + _ASKED,
)
edit(
    "ui/gfx/font_render_params_linux.cc",
    "void SetFontRenderParamsDeviceScaleFactor(float device_scale_factor) {\n"
    "  device_scale_factor_ = device_scale_factor;\n",
    "void SetFontRenderParamsDeviceScaleFactor(float device_scale_factor) {\n"
    "  if (const auto& proteus_screen = base::proteus::GetConfig().screen;\n"
    "      proteus_screen && proteus_screen->pixel_ratio > 0) {\n"
    "    device_scale_factor = static_cast<float>(proteus_screen->pixel_ratio);\n"
    "  }\n"
    "  device_scale_factor_ = device_scale_factor;\n",
)
edit(
    "ui/gfx/font_render_params_linux.cc",
    '#include "base/command_line.h"\n',
    '#include "base/command_line.h"\n#include "base/proteus/proteus_config.h"\n',
)

# 5. A manager that starts profiles the earlier way still asks for the whole browser
#    at the profile's scale; with the scale in the profile that is not wanted. An
#    earlier kernel does not know the profile's scale and obeys the switch, so one
#    manager starts either kernel rightly.
edit(
    "chrome/app/chrome_main_delegate.cc",
    "std::optional<int> ChromeMainDelegate::BasicStartupComplete() {\n"
    "  crash_reporter::InitializeCrashKeys();\n",
    "std::optional<int> ChromeMainDelegate::BasicStartupComplete() {\n"
    "  crash_reporter::InitializeCrashKeys();\n"
    "\n"
    "  // Proteus: see patch 0035.\n"
    "  if (const auto& proteus_screen = base::proteus::GetConfig().screen;\n"
    "      proteus_screen && proteus_screen->pixel_ratio > 0) {\n"
    '    base::CommandLine::ForCurrentProcess()->RemoveSwitch(\n'
    '        "force-device-scale-factor");\n'
    "  }\n",
)
edit(
    "chrome/app/chrome_main_delegate.cc",
    '#include "ui/base/ui_base_switches.h"\n',
    '#include "base/proteus/proteus_config.h"\n#include "ui/base/ui_base_switches.h"\n',
)

# 6. The window's first size is given by the manager in the profile's units: the
#    work area of the profile's screen. In the machine's that is this much.
edit(
    STATE,
    "    if (ParseCommaSeparatedIntegers(str, &width, &height)) {\n"
    "      bounds->set_size(gfx::Size(width, height));\n",
    "    if (ParseCommaSeparatedIntegers(str, &width, &height)) {\n"
    "      if (const auto& screen = base::proteus::GetConfig().screen;\n"
    "          screen && screen->pixel_ratio > 0 && display::Screen::Get()) {\n"
    "        const double real = display::Screen::Get()\n"
    "                                ->GetDisplayMatching(*bounds)\n"
    "                                .device_scale_factor();\n"
    "        if (real > 0) {\n"
    "          width = base::ClampRound(width * screen->pixel_ratio / real);\n"
    "          height = base::ClampRound(height * screen->pixel_ratio / real);\n"
    "        }\n"
    "      }\n"
    "      bounds->set_size(gfx::Size(width, height));\n",
)
edit(
    STATE,
    '#include "chrome/browser/ui/browser_window_state.h"\n',
    '#include "chrome/browser/ui/browser_window_state.h"\n\n'
    '#include "base/numerics/safe_conversions.h"\n'
    '#include "base/proteus/proteus_config.h"\n'
    '#include "ui/display/display.h"\n'
    '#include "ui/display/screen.h"\n',
)

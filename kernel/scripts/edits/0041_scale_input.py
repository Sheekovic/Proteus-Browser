"""Applies the in-place edits of patch 0041 to a Chromium checkout: with a page laid out at
the profile's scale (patch 0035), what drives it finds things where they are.

Read back on Windows, a profile at another scale than the monitor's agreed with a
browser really started at that scale in everything a page measures, and two things
did not:
 - A program driving the profile (Puppeteer, Playwright, Selenium, the manager's own
   browser control) says where to click in the page's CSS pixels. The browser turned
   those into the machine's units by the user's zoom alone, as if a CSS pixel were
   one of the machine's units, so on a monitor at 150% a click meant for 150,170 of a
   profile at 125% landed at 180,204. The profile's scale is now part of that
   conversion.
 - A step of the wheel came out as 99.99999602635717 where it is 100: the division
   went through two rounded numbers. It is now divided by the machine's scale, which
   is what it was multiplied by.
usage: 0041_scale_input.py <chromium-src-dir>"""
import pathlib
import sys

SRC = pathlib.Path(sys.argv[1])
BLINK = "third_party/blink/renderer/"
INPUT = "content/browser/devtools/protocol/input_handler.cc"
WHEEL = BLINK + "core/events/wheel_event.cc"


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


# 1. Places given by a program that drives the browser.
edit(
    INPUT,
    "  float scale_factor = blink::ZoomLevelToZoomFactor(\n"
    "      web_contents_->GetPendingZoomLevel(widget_host_for_zoom_level));\n",
    "  float scale_factor = blink::ZoomLevelToZoomFactor(\n"
    "      web_contents_->GetPendingZoomLevel(widget_host_for_zoom_level));\n"
    "  // Proteus: a CSS pixel of a profile with a scale of its own is not one of\n"
    "  // the machine's units (patch 0035).\n"
    "  if (const auto& proteus_screen = base::proteus::GetConfig().screen;\n"
    "      proteus_screen && proteus_screen->pixel_ratio > 0 &&\n"
    "      widget_host_for_zoom_level) {\n"
    "    const float machine = widget_host_for_zoom_level->GetDeviceScaleFactor();\n"
    "    if (machine > 0) {\n"
    "      scale_factor *=\n"
    "          static_cast<float>(proteus_screen->pixel_ratio) / machine;\n"
    "    }\n"
    "  }\n",
)
edit(
    INPUT,
    '#include "base/functional/bind.h"\n',
    '#include "base/functional/bind.h"\n#include "base/proteus/proteus_config.h"\n',
)

# 2. A step of the wheel. (Worked out here and not in the window's own class: its
#    header is read by half the engine, which would all be compiled again.)
edit(
    WHEEL,
    "namespace blink {\n\nnamespace {\n",
    "namespace blink {\n"
    "\n"
    "namespace {\n"
    "\n"
    "// Proteus: device pixels to a CSS pixel as the machine has them: what a length\n"
    "// that came in the machine's units was multiplied by. With a profile's scale\n"
    "// that is the machine's scale times the user's zoom, the zoom being what the\n"
    "// page is laid out at over the profile's scale: exactly 1 without zoom.\n"
    "double ProteusMachinePixelRatio(const LocalDOMWindow& window) {\n"
    "  const double ratio = window.devicePixelRatio();\n"
    "  const auto& forced = base::proteus::GetConfig().screen;\n"
    "  LocalFrame* frame = window.GetFrame();\n"
    "  if (!forced || forced->pixel_ratio <= 0 || !frame || !frame->GetPage()) {\n"
    "    return ratio;\n"
    "  }\n"
    "  return frame->GetPage()\n"
    "             ->GetChromeClient()\n"
    "             .GetScreenInfo(*frame)\n"
    "             .device_scale_factor *\n"
    "         (ratio / forced->pixel_ratio);\n"
    "}\n",
)
edit(
    WHEEL,
    "      delta_x_(-event.DeltaXInRootFrame() / window.devicePixelRatio() /\n"
    "               window.ProteusScreenScale()),\n"
    "      delta_y_(-event.DeltaYInRootFrame() / window.devicePixelRatio() /\n"
    "               window.ProteusScreenScale()),\n",
    "      delta_x_(-event.DeltaXInRootFrame() / ProteusMachinePixelRatio(window)),\n"
    "      delta_y_(-event.DeltaYInRootFrame() / ProteusMachinePixelRatio(window)),\n",
)
edit(
    WHEEL,
    '#include "third_party/blink/renderer/core/frame/local_dom_window.h"\n',
    '#include "third_party/blink/renderer/core/frame/local_dom_window.h"\n'
    '#include "third_party/blink/renderer/core/frame/local_frame.h"\n'
    '#include "third_party/blink/renderer/core/page/chrome_client.h"\n'
    '#include "third_party/blink/renderer/core/page/page.h"\n',
)
edit(
    WHEEL,
    '#include "third_party/blink/renderer/core/events/wheel_event.h"\n',
    '#include "third_party/blink/renderer/core/events/wheel_event.h"\n\n'
    '#include "base/proteus/proteus_config.h"\n'
    '#include "ui/display/screen_info.h"\n',
)

# 3. And the scale of the one screen a page is told of when it may ask for the
#    screens' details: read back on a machine with three monitors it was the
#    monitor's own, 1.5 on one and 1 on the others, beside a profile at 1.25.
edit(
    BLINK + "modules/screen_details/screen_detailed.cc",
    "float ScreenDetailed::devicePixelRatio() const {\n"
    "  if (!DomWindow())\n"
    "    return 0.f;\n"
    "  return GetScreenInfo().device_scale_factor;\n",
    "float ScreenDetailed::devicePixelRatio() const {\n"
    "  if (!DomWindow())\n"
    "    return 0.f;\n"
    "  if (const auto& forced = base::proteus::GetConfig().screen;\n"
    "      forced && forced->pixel_ratio > 0) {\n"
    "    return static_cast<float>(forced->pixel_ratio);\n"
    "  }\n"
    "  return GetScreenInfo().device_scale_factor;\n",
)

# 4. The fonts that come with Proteus, on Windows (patch 0038). Read back on Windows,
#    a page found none of them by its name: pages there ask a font service in the
#    browser, which keeps a list of side-loaded fonts of its own, and patch 0038 had
#    put the folder's files on another. They go on this one too, the first time
#    anything asks for it.
DIRECT_WRITE = "ui/gfx/win/direct_write.cc"
edit(
    DIRECT_WRITE,
    "std::vector<base::FilePath>* g_sideloaded_fonts = nullptr;\n",
    "std::vector<base::FilePath>* g_sideloaded_fonts = nullptr;\n"
    "\n"
    "// Proteus: the fonts of the profile's folder join the side-loaded ones.\n"
    "void ProteusSideLoadFolder() {\n"
    "  static bool done = false;\n"
    "  if (done) {\n"
    "    return;\n"
    "  }\n"
    "  done = true;\n"
    "  const std::string& font_dir = base::proteus::GetConfig().font_dir;\n"
    "  if (font_dir.empty()) {\n"
    "    return;\n"
    "  }\n"
    "  base::FileEnumerator files(base::FilePath::FromUTF8Unsafe(font_dir),\n"
    "                             /*recursive=*/false,\n"
    "                             base::FileEnumerator::FILES);\n"
    "  for (base::FilePath file = files.Next(); !file.empty();\n"
    "       file = files.Next()) {\n"
    "    if (file.MatchesExtension(FILE_PATH_LITERAL(\".ttf\")) ||\n"
    "        file.MatchesExtension(FILE_PATH_LITERAL(\".otf\")) ||\n"
    "        file.MatchesExtension(FILE_PATH_LITERAL(\".ttc\"))) {\n"
    "      if (!g_sideloaded_fonts) {\n"
    "        g_sideloaded_fonts = new std::vector<base::FilePath>();\n"
    "      }\n"
    "      g_sideloaded_fonts->push_back(file);\n"
    "    }\n"
    "  }\n"
    "}\n",
)
edit(
    DIRECT_WRITE,
    "                       IDWriteFontCollection** collection) {\n"
    "  if (!g_sideloaded_fonts) {\n",
    "                       IDWriteFontCollection** collection) {\n"
    "  ProteusSideLoadFolder();\n"
    "  if (!g_sideloaded_fonts) {\n",
)
edit(
    DIRECT_WRITE,
    "const std::vector<base::FilePath>* GetSideloadedFontsForTesting() {\n"
    "  return g_sideloaded_fonts;\n",
    "const std::vector<base::FilePath>* GetSideloadedFontsForTesting() {\n"
    "  ProteusSideLoadFolder();\n"
    "  return g_sideloaded_fonts;\n",
)
edit(
    DIRECT_WRITE,
    '#include "base/debug/alias.h"\n',
    '#include "base/debug/alias.h"\n'
    '#include "base/files/file_enumerator.h"\n'
    '#include "base/files/file_path.h"\n'
    '#include "base/proteus/proteus_config.h"\n',
)

"""Applies the in-place edits of patch 0042 to a Chromium checkout: a profile run without a
window reads as it does in one, and the window is never larger than its screen.

One and the same profile was read in a window and with --headless=new. Twenty-eight of
thirty things a page reads agreed (the browser's name, the plugins, the permissions,
the graphics card, the voices, ...), and two did not:
 - The window's bars. Without a window there is a frame all the same, of another
   thickness than a real window's (22 by 98 against 14 by 95), which a page gets by
   taking the page's size from the window's. A profile's window now has a real
   window's bars when there is none.
 - The screen's colours. Whether the screen shows the P3 gamut and a high dynamic
   range came from the monitor the window was on: the same for every profile on a
   machine, and gone without a window. They now follow the system the profile claims:
   a Windows or Linux computer has neither, a Mac has P3, an iPhone both. (An Android
   phone's are left as they come: no reading says what its Chrome answers.)
And on a monitor at a smaller scale than the profile's, the window's first size came
out larger than the profile's screen by what its bars do not shrink.
usage: 0042_headless_window.py <chromium-src-dir>"""
import pathlib
import sys

SRC = pathlib.Path(sys.argv[1])
BLINK = "third_party/blink/renderer/"
WINDOW_CC = BLINK + "core/frame/local_dom_window.cc"
MEDIA = BLINK + "core/css/media_values.cc"
CLIENT = "chrome/browser/chrome_content_browser_client.cc"
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


# 1. A page's process is told that there is no window.
edit(
    CLIENT,
    "    command_line->AppendSwitchASCII(base::proteus::kConfigDataSwitch,\n"
    "                                    proteus_config.serialized);\n"
    "  }\n",
    "    command_line->AppendSwitchASCII(base::proteus::kConfigDataSwitch,\n"
    "                                    proteus_config.serialized);\n"
    "  }\n"
    "  // Proteus: see patch 0042.\n"
    "  if (base::CommandLine::ForCurrentProcess()->HasSwitch(\"headless\") &&\n"
    "      !command_line->HasSwitch(\"proteus-headless\")) {\n"
    "    command_line->AppendSwitch(\"proteus-headless\");\n"
    "  }\n",
)

# 2. The window's bars when there is no window: a real window's, as they were measured
#    on Windows at each scale (a sixteenth of an inch of frame, and the tabs and the
#    address bar above the page).
edit(
    WINDOW_CC,
    "// Proteus: where the page's area is on the machine's screen, in the machine's\n",
    "// Proteus: whether the profile runs without a window, and the bars a window of\n"
    "// its scale would have around the page: both sides together, and top and\n"
    "// bottom together.\n"
    "static bool ProteusWithoutWindow() {\n"
    "  static const bool without =\n"
    "      base::CommandLine::ForCurrentProcess()->HasSwitch(\"proteus-headless\");\n"
    "  const base::proteus::Config& config = base::proteus::GetConfig();\n"
    "  return without && config.screen && !config.mobile;\n"
    "}\n"
    "\n"
    "static gfx::Size ProteusWindowBars(float ratio) {\n"
    "  return ratio < 1.25f ? gfx::Size(16, 95)\n"
    "                       : ratio < 2 ? gfx::Size(14, 94) : gfx::Size(13, 93);\n"
    "}\n"
    "\n"
    "// Proteus: where the page's area is on the machine's screen, in the machine's\n",
)
edit(
    WINDOW_CC,
    "  const auto along = [scale](float place, float edge, float start,\n"
    "                             float size) {\n"
    "    const float inside = std::clamp(place - start, 0.f, size);\n"
    "    return (start - edge) + inside * scale + (place - start - inside);\n"
    "  };\n"
    "  return gfx::PointF(\n"
    "      x + along(real.x(), window.x(), view.x(), view.width()),\n"
    "      y + along(real.y(), window.y(), view.y(), view.height()));\n",
    "  const auto along = [scale](float place, float before, float start,\n"
    "                             float size) {\n"
    "    const float inside = std::clamp(place - start, 0.f, size);\n"
    "    return before + inside * scale + (place - start - inside);\n"
    "  };\n"
    "  // Without a window the page begins where it would in one.\n"
    "  float left = view.x() - window.x();\n"
    "  float top = view.y() - window.y();\n"
    "  if (ProteusWithoutWindow()) {\n"
    "    const gfx::Size bars = ProteusWindowBars(\n"
    "        frame->ProteusMachineScale() / std::max(scale, 0.01f));\n"
    "    left = bars.width() / 2;\n"
    "    top = bars.height() - bars.width() / 2;\n"
    "  }\n"
    "  return gfx::PointF(x + along(real.x(), left, view.x(), view.width()),\n"
    "                     y + along(real.y(), top, view.y(), view.height()));\n",
)
edit(
    WINDOW_CC,
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
    "          AdjustForAbsoluteZoom::AdjustInt(area.height(), ratio));\n",
    "  const bool without_window = ProteusWithoutWindow();\n"
    "  if (view.IsEmpty() || (scale == 1 && !without_window)) {\n"
    "    return gfx::SizeF(window.width() * scale, window.height() * scale);\n"
    "  }\n"
    "  // The page's area, rounded as its inner size is.\n"
    "  const gfx::Size area = frame->LocalFrameRoot().View()->Size();\n"
    "  const float ratio = frame->ProteusMachineScale() / scale;\n"
    "  const gfx::Size bars =\n"
    "      without_window ? ProteusWindowBars(ratio)\n"
    "                     : gfx::Size(window.width() - view.width(),\n"
    "                                 window.height() - view.height());\n"
    "  return gfx::SizeF(\n"
    "      bars.width() + AdjustForAbsoluteZoom::AdjustInt(area.width(), ratio),\n"
    "      bars.height() + AdjustForAbsoluteZoom::AdjustInt(area.height(), ratio));\n",
)

# 3. The screen's colours, by the system the profile claims.
edit(
    MEDIA,
    "bool MediaValues::CalculateDeviceSupportsHDR(LocalFrame* frame) {\n"
    "  DCHECK(frame);\n"
    "  DCHECK(frame->GetPage());\n",
    "// Proteus: what the screen of the system a profile claims shows: 0 only the\n"
    "// usual colours, 1 the P3 gamut too, 2 also a high dynamic range, and -1 for\n"
    "// no profile's screen, or a system nothing is known of.\n"
    "static int ProteusScreenColours() {\n"
    "  const base::proteus::Config& config = base::proteus::GetConfig();\n"
    "  if (!config.screen) {\n"
    "    return -1;\n"
    "  }\n"
    "  const std::string& platform = config.navigator_platform;\n"
    "  if (platform.starts_with(\"Win\") || platform.starts_with(\"Linux x86\")) {\n"
    "    return 0;\n"
    "  }\n"
    "  if (platform.starts_with(\"Mac\")) {\n"
    "    return 1;\n"
    "  }\n"
    "  if (platform.starts_with(\"iPhone\")) {\n"
    "    return 2;\n"
    "  }\n"
    "  return -1;\n"
    "}\n"
    "\n"
    "bool MediaValues::CalculateDeviceSupportsHDR(LocalFrame* frame) {\n"
    "  DCHECK(frame);\n"
    "  DCHECK(frame->GetPage());\n"
    "  if (const int colours = ProteusScreenColours(); colours >= 0) {\n"
    "    return colours == 2;\n"
    "  }\n",
)
edit(
    MEDIA,
    "  std::optional<ColorSpaceGamut> override_value =\n"
    "      overrides ? overrides->GetColorGamut() : std::nullopt;\n",
    "  std::optional<ColorSpaceGamut> override_value =\n"
    "      overrides ? overrides->GetColorGamut() : std::nullopt;\n"
    "  if (const int colours = ProteusScreenColours();\n"
    "      !override_value && colours >= 0) {\n"
    "    return colours == 0 ? ColorSpaceGamut::SRGB : ColorSpaceGamut::P3;\n"
    "  }\n",
)

# 4. The window's first size, where the monitor's scale is smaller than the profile's:
#    the bars do not shrink with the page, so room is left for them (they are never
#    more than some 40 units wide and 160 high together).
edit(
    STATE,
    "          width = base::ClampRound(width * screen->pixel_ratio / real);\n"
    "          height = base::ClampRound(height * screen->pixel_ratio / real);\n",
    "          const double larger = screen->pixel_ratio / real;\n"
    "          const double room = larger > 1 ? larger - 1 : 0;\n"
    "          width = base::ClampRound(width * larger - 40 * room);\n"
    "          height = base::ClampRound(height * larger - 160 * room);\n",
)

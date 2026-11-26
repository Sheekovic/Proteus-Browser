"""Applies the in-place edits of patch 0039 to a Chromium checkout: the sizes and places a
page gives a window are in the page's own pixels.

Patch 0035 has pages laid out at the profile's scale while the window is drawn at the
machine's, and turns what a page reads about the window into the page's pixels. What a
page says went the other way unchanged: a window opened 400 wide was 400 of the
machine's units, which the new page read back as 480 or 333, and resizeTo() and
moveTo() missed by the same factor. They are now turned into the machine's units on
the way out, by the reverse of what patch 0035 does on the way in.
usage: 0039_window_units.py <chromium-src-dir>"""
import pathlib
import sys

SRC = pathlib.Path(sys.argv[1])
BLINK = "third_party/blink/renderer/"
WINDOW_CC = BLINK + "core/frame/local_dom_window.cc"
WINDOW_H = BLINK + "core/frame/local_dom_window.h"
CREATE = BLINK + "core/page/create_window.cc"


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


# 1. The reverse of ProteusScreenPoint() and ProteusOuterSize().
edit(
    WINDOW_H,
    "  gfx::SizeF ProteusOuterSize() const;\n",
    "  gfx::SizeF ProteusOuterSize() const;\n"
    "  // Proteus: the other way: a length, a place on the screen and a window's\n"
    "  // size that a page gives in its own pixels, in the machine's units.\n"
    "  int ProteusMachineLength(int length) const;\n"
    "  gfx::Point ProteusMachinePoint(int x, int y) const;\n"
    "  gfx::Size ProteusMachineOuterSize(int width, int height) const;\n",
)
edit(
    WINDOW_CC,
    "int LocalDOMWindow::screenX() const {\n",
    "int LocalDOMWindow::ProteusMachineLength(int length) const {\n"
    "  return static_cast<int>(lroundf(length / ProteusScreenScale()));\n"
    "}\n"
    "\n"
    "gfx::Point LocalDOMWindow::ProteusMachinePoint(int x, int y) const {\n"
    "  LocalFrame* frame = GetFrame();\n"
    "  if (!base::proteus::GetConfig().screen || !frame || !frame->GetPage()) {\n"
    "    return gfx::Point(x, y);\n"
    "  }\n"
    "  // A page's screen starts at 0,0; the machine's screen it is on may not.\n"
    "  const gfx::Rect screen =\n"
    "      frame->GetPage()->GetChromeClient().GetScreenInfo(*frame).rect;\n"
    "  return gfx::Point(screen.x() + ProteusMachineLength(x),\n"
    "                    screen.y() + ProteusMachineLength(y));\n"
    "}\n"
    "\n"
    "gfx::Size LocalDOMWindow::ProteusMachineOuterSize(int width, int height) const {\n"
    "  LocalFrame* frame = GetFrame();\n"
    "  const float scale = ProteusScreenScale();\n"
    "  if (scale == 1 || !frame || !frame->GetPage()) {\n"
    "    return gfx::Size(width, height);\n"
    "  }\n"
    "  // The window's bars are as thick as they are; the rest is the page's.\n"
    "  const gfx::Rect window =\n"
    "      frame->GetPage()->GetChromeClient().RootWindowRect(*frame);\n"
    "  const gfx::Rect view = ProteusViewOnScreen(frame);\n"
    "  const int bars_wide = view.IsEmpty() ? 0 : window.width() - view.width();\n"
    "  const int bars_high = view.IsEmpty() ? 0 : window.height() - view.height();\n"
    "  return gfx::Size(\n"
    "      bars_wide + static_cast<int>(lroundf((width - bars_wide) / scale)),\n"
    "      bars_high + static_cast<int>(lroundf((height - bars_high) / scale)));\n"
    "}\n"
    "\n"
    "int LocalDOMWindow::screenX() const {\n",
)

# 2. moveBy, moveTo, resizeBy, resizeTo.
edit(
    WINDOW_CC,
    "  window_rect.Offset(x, y);\n",
    "  window_rect.Offset(ProteusMachineLength(x), ProteusMachineLength(y));\n",
)
edit(
    WINDOW_CC,
    "    page->GetChromeClient().MoveWindowTo(gfx::Point(x, y), *frame);\n",
    "    page->GetChromeClient().MoveWindowTo(ProteusMachinePoint(x, y), *frame);\n",
)
edit(
    WINDOW_CC,
    "    window_rect.set_origin(gfx::Point(x, y));\n",
    "    window_rect.set_origin(ProteusMachinePoint(x, y));\n",
)
edit(
    WINDOW_CC,
    "  gfx::Size dest(fr.width() + x, fr.height() + y);\n",
    "  gfx::Size dest(fr.width() + ProteusMachineLength(x),\n"
    "                 fr.height() + ProteusMachineLength(y));\n",
)
edit(
    WINDOW_CC,
    "  const gfx::Size dest(width, height);\n",
    "  const gfx::Size dest = ProteusMachineOuterSize(width, height);\n",
)

# 3. window.open(): the size asked for is the new page's, the place the window's.
edit(
    CREATE,
    "  if (features.height) {\n"
    "    features.height = std::max(features.height, min_size);\n"
    "  }\n",
    "  if (features.height) {\n"
    "    features.height = std::max(features.height, min_size);\n"
    "  }\n"
    "  // Proteus: in the page's own pixels (patch 0039).\n"
    "  if (opener_window.ProteusScreenScale() != 1) {\n"
    "    if (features.width) {\n"
    "      features.width = opener_window.ProteusMachineLength(features.width);\n"
    "    }\n"
    "    if (features.height) {\n"
    "      features.height = opener_window.ProteusMachineLength(features.height);\n"
    "    }\n"
    "    if (features.x_set || features.y_set) {\n"
    "      const gfx::Point place =\n"
    "          opener_window.ProteusMachinePoint(features.x, features.y);\n"
    "      if (features.x_set) {\n"
    "        features.x = place.x();\n"
    "      }\n"
    "      if (features.y_set) {\n"
    "        features.y = place.y();\n"
    "      }\n"
    "    }\n"
    "  }\n",
)

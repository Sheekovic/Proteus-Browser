"""Applies the in-place edits of patch 0014 to a Chromium checkout: CSS generic font
families keep resolving to the system's font for them under a font list.
New files are copied from kernel/src by the caller.
usage: 0014_generic_fonts.py <chromium-src-dir>"""
import pathlib
import sys

SRC = pathlib.Path(sys.argv[1])
CSS = "third_party/blink/renderer/core/css/"
FILTER_INCLUDE = (
    '#include "third_party/blink/renderer/platform/fonts/proteus_font_filter.h"\n'
)


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


SCOPE = (
    "  ProteusGenericFontLookupScope proteus_generic_lookup(\n"
    "      font_family.FamilyIsGeneric());\n"
)

# Documents.
SELECTOR = CSS + "css_font_selector.cc"
edit(
    SELECTOR,
    "  const SimpleFontData* font_data =\n"
    "      FontCache::Get().GetFontData(request_description, settings_family_name);\n",
    SCOPE
    + "  const SimpleFontData* font_data =\n"
    "      FontCache::Get().GetFontData(request_description, settings_family_name);\n",
)
edit(
    SELECTOR,
    '#include "third_party/blink/renderer/core/css/css_font_selector.h"\n',
    '#include "third_party/blink/renderer/core/css/css_font_selector.h"\n\n' + FILTER_INCLUDE,
)

# Workers (OffscreenCanvas text).
OFFSCREEN = CSS + "offscreen_font_selector.cc"
edit(
    OFFSCREEN,
    "  return FontCache::Get().GetFontData(font_description, settings_family_name);\n",
    SCOPE
    + "  return FontCache::Get().GetFontData(font_description, settings_family_name);\n",
)
edit(
    OFFSCREEN,
    '#include "third_party/blink/renderer/core/css/offscreen_font_selector.h"\n',
    '#include "third_party/blink/renderer/core/css/offscreen_font_selector.h"\n\n'
    + FILTER_INCLUDE,
)

"""Applies the in-place edits of patch 0008 (installed-font allow-list) to a Chromium
checkout. New files are copied from kernel/src by the caller.
usage: 0008_fonts.py <chromium-src-dir>"""
import pathlib
import sys

SRC = pathlib.Path(sys.argv[1])
PLATFORM = "third_party/blink/renderer/platform/"
CACHE = PLATFORM + "fonts/font_cache.cc"


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


# 1. Compile the filter into blink platform.
edit(
    PLATFORM + "BUILD.gn",
    '    "fonts/font_cache.cc",\n',
    '    "fonts/font_cache.cc",\n'
    '    "fonts/proteus_font_filter.cc",\n    "fonts/proteus_font_filter.h",\n',
)

# 2. font-family lookups by name. The last-resort lookup is exempt: it is how the
#    browser finds *some* font once every requested family has failed.
edit(
    CACHE,
    "    AlternateFontName altername_font_name) {\n"
    "  if (const FontPlatformData* platform_data = GetFontPlatformData(\n",
    "    AlternateFontName altername_font_name) {\n"
    "  if (altername_font_name != AlternateFontName::kLastResort &&\n"
    "      ProteusIsFontFamilyHidden(family)) {\n"
    "    return nullptr;\n"
    "  }\n"
    "  if (const FontPlatformData* platform_data = GetFontPlatformData(\n",
)

# 3. "Is this family installed?" checks.
edit(
    CACHE,
    "    const AtomicString& family) {\n"
    "  return GetFontPlatformData(\n",
    "    const AtomicString& family) {\n"
    "  if (ProteusIsFontFamilyHidden(family)) {\n"
    "    return false;\n"
    "  }\n"
    "  return GetFontPlatformData(\n",
)

# 4. @font-face src: local("Full Font Name").
edit(
    CACHE,
    "  if (unique_font_name.empty()) {\n"
    "    return false;\n"
    "  }\n",
    "  if (unique_font_name.empty()) {\n"
    "    return false;\n"
    "  }\n"
    "  if (ProteusIsUniqueFontNameHidden(unique_font_name)) {\n"
    "    return false;\n"
    "  }\n",
)

edit(
    CACHE,
    '#include "third_party/blink/renderer/platform/fonts/font_cache.h"\n',
    '#include "third_party/blink/renderer/platform/fonts/font_cache.h"\n'
    '#include "third_party/blink/renderer/platform/fonts/proteus_font_filter.h"\n',
)

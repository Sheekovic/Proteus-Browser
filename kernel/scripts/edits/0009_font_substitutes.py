"""Applies the in-place edits of patch 0009 (font substitution) to a Chromium checkout
that already has patch 0008 (font allow-list) applied.
usage: 0009_font_substitutes.py <chromium-src-dir>"""
import pathlib
import sys

SRC = pathlib.Path(sys.argv[1])
CACHE = "third_party/blink/renderer/platform/fonts/font_cache.cc"


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


# 1. FontCache::GetFontData serves both font-family lookups and @font-face local()
#    lookups (the latter pass a full font name). Patch 0008 applied the family rule
#    to both, which hid local("Arial Bold") even when Arial was allowed. Use the
#    matching rule for each kind.
edit(
    CACHE,
    "  if (altername_font_name != AlternateFontName::kLastResort &&\n"
    "      ProteusIsFontFamilyHidden(family)) {\n"
    "    return nullptr;\n"
    "  }\n",
    "  const bool proteus_by_unique_name =\n"
    "      altername_font_name == AlternateFontName::kLocalUniqueFace;\n"
    "  if (proteus_by_unique_name) {\n"
    "    if (ProteusIsUniqueFontNameHidden(family)) {\n"
    "      return nullptr;\n"
    "    }\n"
    "  } else if (altername_font_name != AlternateFontName::kLastResort &&\n"
    "             ProteusIsFontFamilyHidden(family)) {\n"
    "    return nullptr;\n"
    "  }\n",
)

# 2. ... and when the real font is missing, try the profile's substitutes.
edit(
    CACHE,
    "    return FontDataFromFontPlatformData(\n"
    "        platform_data, font_description.SubpixelAscentDescent());\n"
    "  }\n"
    "\n"
    "  return nullptr;\n"
    "}\n",
    "    return FontDataFromFontPlatformData(\n"
    "        platform_data, font_description.SubpixelAscentDescent());\n"
    "  }\n"
    "\n"
    "  if (altername_font_name != AlternateFontName::kLastResort) {\n"
    "    for (const AtomicString& substitute :\n"
    "         proteus_by_unique_name\n"
    "             ? ProteusUniqueFontNameSubstitutes(family)\n"
    "             : ProteusFontFamilySubstitutes(family)) {\n"
    "      if (const FontPlatformData* platform_data = GetFontPlatformData(\n"
    "              font_description, FontFaceCreationParams(substitute),\n"
    "              altername_font_name)) {\n"
    "        return FontDataFromFontPlatformData(\n"
    "            platform_data, font_description.SubpixelAscentDescent());\n"
    "      }\n"
    "    }\n"
    "  }\n"
    "\n"
    "  return nullptr;\n"
    "}\n",
)

# 3. "Is this family installed?"
edit(
    CACHE,
    "  return GetFontPlatformData(\n"
    "      font_description,\n"
    "      FontFaceCreationParams(AdjustFamilyNameToAvoidUnsupportedFonts(family)),\n"
    "      AlternateFontName::kNoAlternate);\n"
    "}\n",
    "  if (GetFontPlatformData(\n"
    "          font_description,\n"
    "          FontFaceCreationParams(\n"
    "              AdjustFamilyNameToAvoidUnsupportedFonts(family)),\n"
    "          AlternateFontName::kNoAlternate)) {\n"
    "    return true;\n"
    "  }\n"
    "  for (const AtomicString& substitute : ProteusFontFamilySubstitutes(family)) {\n"
    "    if (GetFontPlatformData(font_description,\n"
    "                            FontFaceCreationParams(substitute),\n"
    "                            AlternateFontName::kNoAlternate)) {\n"
    "      return true;\n"
    "    }\n"
    "  }\n"
    "  return false;\n"
    "}\n",
)

# 4. "Is this full font name installed?" (@font-face local())
edit(
    CACHE,
    "  return GetFontPlatformData(font_description,\n"
    "                             FontFaceCreationParams(unique_font_name),\n"
    "                             AlternateFontName::kLocalUniqueFace);\n"
    "}\n",
    "  if (GetFontPlatformData(font_description,\n"
    "                          FontFaceCreationParams(unique_font_name),\n"
    "                          AlternateFontName::kLocalUniqueFace)) {\n"
    "    return true;\n"
    "  }\n"
    "  for (const AtomicString& substitute :\n"
    "       ProteusUniqueFontNameSubstitutes(unique_font_name)) {\n"
    "    if (GetFontPlatformData(font_description,\n"
    "                            FontFaceCreationParams(substitute),\n"
    "                            AlternateFontName::kLocalUniqueFace)) {\n"
    "      return true;\n"
    "    }\n"
    "  }\n"
    "  return false;\n"
    "}\n",
)

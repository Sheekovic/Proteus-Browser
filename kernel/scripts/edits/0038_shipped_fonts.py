"""Applies the in-place edits of patch 0038 to a Chromium checkout: a profile can name a
folder of font files that count as installed.

A profile of another system claims that system's fonts and hides the machine's, and
until now drew every one of them with a stand-in chosen from what the machine has: a
page found the name "Roboto" and measured Arial. With a folder of fonts that come
with Proteus (Android's own fonts, which may be passed on, and for the others fonts
made to have the same measures), the claimed font is the font, or a stand-in that is
the same on every machine.

Both systems already know how to add font files to the installed ones, for the
browser's own tests; the folder's files are added that way:
 - Windows: to the font collection the browser hands the pages' processes;
 - Linux: to Fontconfig's configuration, which the browser answers font questions from.
Which of them a page finds is still decided by the profile's font list (patch 0008).

A system also answers to names it has no font for, with a face of its own: Android
draws "Arial" with Roboto. A stand-in (patch 0009) is only used when the name is not
installed, and on a machine that has Arial, or that answers to it itself as Linux
does, the profile drew the machine's. The profile now says which face answers to
which name, and that face is used first.
usage: 0038_shipped_fonts.py <chromium-src-dir>"""
import pathlib
import sys

SRC = pathlib.Path(sys.argv[1])
DWRITE = "content/browser/renderer_host/dwrite_font_proxy_impl_win.cc"
CACHE = "third_party/blink/renderer/platform/fonts/font_cache.cc"
FONTCONFIG = "ui/gfx/linux/fontconfig_util.cc"


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


# 1. Windows.
edit(
    DWRITE,
    "  // Normally identical to factory_->GetSystemFontCollection() unless a\n"
    "  // sideloaded font has been added using SideLoadFontForTesting().\n",
    "  // Proteus: the fonts of the profile's folder count as installed.\n"
    "  static bool proteus_fonts_added = false;\n"
    "  if (const std::string& font_dir = base::proteus::GetConfig().font_dir;\n"
    "      !proteus_fonts_added && !font_dir.empty()) {\n"
    "    proteus_fonts_added = true;\n"
    "    base::FileEnumerator files(base::FilePath::FromUTF8Unsafe(font_dir),\n"
    "                               /*recursive=*/false,\n"
    "                               base::FileEnumerator::FILES);\n"
    "    for (base::FilePath file = files.Next(); !file.empty();\n"
    "         file = files.Next()) {\n"
    "      if (file.MatchesExtension(FILE_PATH_LITERAL(\".ttf\")) ||\n"
    "          file.MatchesExtension(FILE_PATH_LITERAL(\".otf\")) ||\n"
    "          file.MatchesExtension(FILE_PATH_LITERAL(\".ttc\"))) {\n"
    "        SideLoadFontForTesting(file);\n"
    "      }\n"
    "    }\n"
    "  }\n"
    "\n"
    "  // Normally identical to factory_->GetSystemFontCollection() unless a\n"
    "  // sideloaded font has been added using SideLoadFontForTesting().\n",
)
edit(
    DWRITE,
    '#include "content/browser/renderer_host/dwrite_font_proxy_impl_win.h"\n',
    '#include "content/browser/renderer_host/dwrite_font_proxy_impl_win.h"\n\n'
    '#include "base/files/file_enumerator.h"\n'
    '#include "base/files/file_path.h"\n'
    '#include "base/proteus/proteus_config.h"\n',
)

# 2. Linux.
edit(
    FONTCONFIG,
    "    fc_config_ = FcConfigGetCurrent();\n"
    "    FcConfigReference(fc_config_);\n",
    "    fc_config_ = FcConfigGetCurrent();\n"
    "    FcConfigReference(fc_config_);\n"
    "    // Proteus: the fonts of the profile's folder count as installed.\n"
    "    if (const std::string& font_dir = base::proteus::GetConfig().font_dir;\n"
    "        !font_dir.empty()) {\n"
    "      FcConfigAppFontAddDir(\n"
    "          fc_config_, reinterpret_cast<const FcChar8*>(font_dir.c_str()));\n"
    "    }\n",
)
edit(
    FONTCONFIG,
    '#include "ui/gfx/linux/fontconfig_util.h"\n',
    '#include "ui/gfx/linux/fontconfig_util.h"\n\n#include "base/proteus/proteus_config.h"\n',
)

# (An earlier revision of step 3 misspelt two names.)
_cache = SRC / CACHE
_text = _cache.read_text(encoding="utf-8")
if "AtomicString::FromUTF8(face)" in _text:
    _cache.write_text(
        _text.replace("String::FromUTF8(name)", "String::FromUtf8(name)").replace(
            "AtomicString::FromUTF8(face)", "AtomicString(String::FromUtf8(face))"
        ),
        encoding="utf-8",
        newline="\n",
    )
    print("corrected two names")

# 3. A name the claimed system answers to with a face of its own gets that face,
#    whatever the machine has by that name.
edit(
    CACHE,
    "  if (const FontPlatformData* platform_data = GetFontPlatformData(\n"
    "          font_description,\n"
    "          FontFaceCreationParams(\n"
    "              AdjustFamilyNameToAvoidUnsupportedFonts(family)),\n"
    "          altername_font_name)) {\n"
    "    return FontDataFromFontPlatformData(\n"
    "        platform_data, font_description.SubpixelAscentDescent());\n"
    "  }\n"
    "\n"
    "  if (altername_font_name != AlternateFontName::kLastResort) {\n",
    "  if (!proteus_by_unique_name &&\n"
    "      altername_font_name != AlternateFontName::kLastResort) {\n"
    "    for (const auto& [name, face] : base::proteus::GetConfig().font_answers) {\n"
    "      if (!DeprecatedEqualIgnoringCase(family, String::FromUtf8(name))) {\n"
    "        continue;\n"
    "      }\n"
    "      if (const FontPlatformData* platform_data = GetFontPlatformData(\n"
    "              font_description,\n"
    "              FontFaceCreationParams(AtomicString(String::FromUtf8(face))),\n"
    "              altername_font_name)) {\n"
    "        return FontDataFromFontPlatformData(\n"
    "            platform_data, font_description.SubpixelAscentDescent());\n"
    "      }\n"
    "    }\n"
    "  }\n"
    "  if (const FontPlatformData* platform_data = GetFontPlatformData(\n"
    "          font_description,\n"
    "          FontFaceCreationParams(\n"
    "              AdjustFamilyNameToAvoidUnsupportedFonts(family)),\n"
    "          altername_font_name)) {\n"
    "    return FontDataFromFontPlatformData(\n"
    "        platform_data, font_description.SubpixelAscentDescent());\n"
    "  }\n"
    "\n"
    "  if (altername_font_name != AlternateFontName::kLastResort) {\n",
)
edit(
    CACHE,
    '#include "third_party/blink/renderer/platform/fonts/font_cache.h"\n',
    '#include "third_party/blink/renderer/platform/fonts/font_cache.h"\n\n'
    '#include "base/proteus/proteus_config.h"\n',
)

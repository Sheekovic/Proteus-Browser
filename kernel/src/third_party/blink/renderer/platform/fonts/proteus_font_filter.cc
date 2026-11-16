// Copyright 2026 The Proteus Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#include "third_party/blink/renderer/platform/fonts/proteus_font_filter.h"

#include <string>
#include <string_view>
#include <utility>
#include <vector>

#include "base/containers/flat_map.h"
#include "base/containers/flat_set.h"
#include "base/containers/span.h"
#include "base/no_destructor.h"
#include "base/proteus/proteus_config.h"
#include "base/strings/string_util.h"
#include "third_party/blink/renderer/platform/wtf/text/wtf_string.h"

namespace blink {

namespace {

// Families the browser resolves the CSS generic keywords and its own UI to.
// Always allowed, so ordinary pages render as they would without a font list.
constexpr std::string_view kAlwaysAllowed[] = {
    "serif",      "sans-serif", "sans",        "monospace",
    "cursive",    "fantasy",    "system-ui",   "math",
    "arial",      "times new roman",           "courier new",
    "helvetica",  "times",      "courier",     "ui-sans-serif",
    "ui-serif",   "ui-monospace",              "ui-rounded",
    "emoji",      "fangsong",
};

// The profile's font list in lower case; empty when no list is configured.
const std::vector<std::string>& AllowedFamilies() {
  static const base::NoDestructor<std::vector<std::string>> families([] {
    std::vector<std::string> result;
    for (const std::string& font : base::proteus::GetConfig().fonts) {
      result.push_back(base::ToLowerASCII(font));
    }
    return result;
  }());
  return *families;
}

// Lower-cased family -> its substitutes, as configured by the profile.
using AliasMap = base::flat_map<std::string, std::vector<std::string>>;

const AliasMap& Aliases() {
  static const base::NoDestructor<AliasMap> aliases([] {
    std::vector<AliasMap::value_type> entries;
    for (const base::proteus::FontAlias& alias :
         base::proteus::GetConfig().font_aliases) {
      entries.emplace_back(base::ToLowerASCII(alias.family), alias.substitutes);
    }
    return AliasMap(std::move(entries));
  }());
  return *aliases;
}

const base::flat_set<std::string>& AllowedFamilySet() {
  static const base::NoDestructor<base::flat_set<std::string>> set([] {
    std::vector<std::string> names = AllowedFamilies();
    for (std::string_view name : kAlwaysAllowed) {
      names.emplace_back(name);
    }
    // A family with substitutes is one the profile claims, so it is allowed.
    for (const auto& [family, substitutes] : Aliases()) {
      names.push_back(family);
    }
    return base::flat_set<std::string>(std::move(names));
  }());
  return *set;
}

AtomicString ToAtomic(const std::string& utf8) {
  return AtomicString(String::FromUtf8(base::as_byte_span(utf8)));
}

// Words that name a style of a family rather than a different family. Longer
// words come before their prefixes so the greedy match below takes them whole.
constexpr std::string_view kStyleWords[] = {
    "extralight", "ultralight", "extrabold", "ultrabold", "semibold",
    "demibold",   "hairline",   "regular",   "oblique",   "italic",
    "medium",     "normal",     "light",     "black",     "heavy",
    "roman",      "bold",       "book",      "thin",      "demi",
    "psmt",       "mt",         "ps",
};

// Weight and width words the browser strips from the end of a family name on
// Windows before looking the family up (longer words before their suffixes).
constexpr std::string_view kFamilySuffixWords[] = {
    "ultracondensed", "extracondensed", "semicondensed", "condensed",
    "semiexpanded",   "extraexpanded",  "ultraexpanded", "expanded",
    "extralight",     "ultralight",     "semilight",     "light",
    "extrabold",      "ultrabold",      "demibold",      "semibold",
    "bold",           "thin",           "regular",       "medium",
    "heavy",          "black",
};

// True when |rest|, the part of a font name after its family, consists only of
// style words: "" or " bold italic" or "-boldoblique", but not " mono", which
// would make it the separate family "DejaVu Sans Mono".
bool IsStyleSuffix(std::string_view rest) {
  while (!rest.empty()) {
    if (rest.front() == ' ' || rest.front() == '-') {
      rest.remove_prefix(1);
      continue;
    }
    bool matched = false;
    for (std::string_view word : kStyleWords) {
      if (rest.starts_with(word)) {
        rest.remove_prefix(word.size());
        matched = true;
        break;
      }
    }
    if (!matched) {
      return false;
    }
  }
  return true;
}

// Number of live generic-family lookups on this thread.
constinit thread_local int g_generic_lookup_depth = 0;

}  // namespace

ProteusGenericFontLookupScope::ProteusGenericFontLookupScope(bool generic)
    : generic_(generic) {
  if (generic_) {
    ++g_generic_lookup_depth;
  }
}

ProteusGenericFontLookupScope::~ProteusGenericFontLookupScope() {
  if (generic_) {
    --g_generic_lookup_depth;
  }
}

bool ProteusIsFontFamilyHidden(const AtomicString& family) {
  if (AllowedFamilies().empty() || family.empty() ||
      g_generic_lookup_depth > 0) {
    return false;
  }
  std::string name = base::ToLowerASCII(family.Utf8());
  if (AllowedFamilySet().contains(name)) {
    return false;
  }
  // The browser itself accepts a family name with a weight or width word on
  // the end ("Corbel Light", "Bahnschrift SemiBold Condensed") by dropping the
  // word and asking for that style of the family. Such a name must be as
  // visible as its family, or measuring text would disagree with local().
  for (int dropped = 0; dropped < 2; ++dropped) {
    bool stripped = false;
    for (std::string_view word : kFamilySuffixWords) {
      if (name.size() > word.size() + 1 && name.ends_with(word) &&
          name[name.size() - word.size() - 1] == ' ') {
        name.resize(name.size() - word.size() - 1);
        stripped = true;
        break;
      }
    }
    if (!stripped) {
      break;
    }
    if (AllowedFamilySet().contains(name)) {
      return false;
    }
  }
  return true;
}

bool ProteusIsUniqueFontNameHidden(const AtomicString& name) {
  if (AllowedFamilies().empty() || name.empty()) {
    return false;
  }
  // A full font name starts with its family ("Arial Bold"); a PostScript name
  // does so with the spaces removed ("Arial-BoldMT", "DejaVuSans-Bold").
  const std::string full = base::ToLowerASCII(name.Utf8());
  std::string compact_full;
  base::RemoveChars(full, " ", &compact_full);
  for (const std::string& family : AllowedFamilySet()) {
    std::string compact_family;
    base::RemoveChars(family, " ", &compact_family);
    if (full.starts_with(family) &&
        IsStyleSuffix(std::string_view(full).substr(family.size()))) {
      return false;
    }
    if (compact_full.starts_with(compact_family) &&
        IsStyleSuffix(
            std::string_view(compact_full).substr(compact_family.size()))) {
      return false;
    }
  }
  return true;
}

Vector<AtomicString> ProteusFontFamilySubstitutes(const AtomicString& family) {
  Vector<AtomicString> result;
  if (Aliases().empty() || family.empty()) {
    return result;
  }
  const auto it = Aliases().find(base::ToLowerASCII(family.Utf8()));
  if (it != Aliases().end()) {
    for (const std::string& substitute : it->second) {
      result.push_back(ToAtomic(substitute));
    }
  }
  return result;
}

Vector<AtomicString> ProteusUniqueFontNameSubstitutes(const AtomicString& name) {
  Vector<AtomicString> result;
  if (Aliases().empty() || name.empty()) {
    return result;
  }
  const std::string original = name.Utf8();
  const std::string full = base::ToLowerASCII(original);
  for (const auto& [family, substitutes] : Aliases()) {
    if (!full.starts_with(family)) {
      continue;
    }
    // Keep the style part ("" or " Bold Italic") and put it on the substitute.
    const std::string_view style =
        std::string_view(original).substr(family.size());
    if (!IsStyleSuffix(std::string_view(full).substr(family.size()))) {
      continue;
    }
    for (const std::string& substitute : substitutes) {
      result.push_back(ToAtomic(substitute + std::string(style)));
    }
  }
  return result;
}

}  // namespace blink

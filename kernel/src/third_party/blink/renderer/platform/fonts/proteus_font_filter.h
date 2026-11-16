// Copyright 2026 The Proteus Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#ifndef THIRD_PARTY_BLINK_RENDERER_PLATFORM_FONTS_PROTEUS_FONT_FILTER_H_
#define THIRD_PARTY_BLINK_RENDERER_PLATFORM_FONTS_PROTEUS_FONT_FILTER_H_

#include "third_party/blink/renderer/platform/platform_export.h"
#include "third_party/blink/renderer/platform/wtf/text/atomic_string.h"
#include "third_party/blink/renderer/platform/wtf/vector.h"

namespace blink {

// Installed-font allow-list.
//
// Pages detect installed fonts by asking for a family by name and observing
// whether text changes size, or through @font-face local() sources. When the
// active Proteus profile lists its fonts, a family outside that list is reported
// as not installed, so the detectable font set belongs to the profile instead of
// to the machine.
//
// The families the browser itself substitutes for the CSS generic keywords
// (serif, sans-serif, monospace, ...) are always allowed; hiding them would
// change how ordinary pages render. Character fallback for scripts the chosen
// font lacks is not affected either.

// True when a lookup of font family |family| must fail.
PLATFORM_EXPORT bool ProteusIsFontFamilyHidden(const AtomicString& family);

// True when a lookup by full or PostScript font name (an @font-face local()
// source, e.g. "Arial Bold") must fail.
PLATFORM_EXPORT bool ProteusIsUniqueFontNameHidden(const AtomicString& name);

// Font substitution.
//
// A profile can claim fonts the machine does not have (a macOS profile on a
// Windows machine claims Helvetica Neue). For such a family the profile names
// substitutes; when the real family is missing, callers look up each substitute
// in turn so the claimed family is found and renders with the stand-in. A family
// that is really installed is never substituted.

// Families that may stand in for |family|, in order of preference. Empty when
// the profile defines none.
PLATFORM_EXPORT Vector<AtomicString> ProteusFontFamilySubstitutes(
    const AtomicString& family);

// The same for a full or PostScript font name: "Helvetica Neue Bold" yields
// "<substitute> Bold" for each substitute of Helvetica Neue.
PLATFORM_EXPORT Vector<AtomicString> ProteusUniqueFontNameSubstitutes(
    const AtomicString& name);

// While one of these with |generic| true is alive on a thread, family lookups
// are not filtered. Used while the browser resolves a CSS generic family
// (serif, monospace, system-ui, ...) to the font the system uses for it: that
// font is not on a profile's list when the list describes another system, yet
// "monospace" must still be a monospace font. Asking for the same font by its
// own name stays filtered.
class PLATFORM_EXPORT ProteusGenericFontLookupScope {
 public:
  explicit ProteusGenericFontLookupScope(bool generic);
  ProteusGenericFontLookupScope(const ProteusGenericFontLookupScope&) = delete;
  ProteusGenericFontLookupScope& operator=(
      const ProteusGenericFontLookupScope&) = delete;
  ~ProteusGenericFontLookupScope();

 private:
  const bool generic_;
};

}  // namespace blink

#endif  // THIRD_PARTY_BLINK_RENDERER_PLATFORM_FONTS_PROTEUS_FONT_FILTER_H_

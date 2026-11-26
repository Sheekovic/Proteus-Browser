#!/usr/bin/env bash
# Fetches the fonts that come with Proteus (release/fonts.txt) and lays them out as a
# release folder has them:
#
#   <out>/fonts/              the font files, which the kernel counts as installed
#   <out>/licenses/fonts/     each family's licence, as it came with it
#
# Every file is checked against the list's checksum; a file that is already there and
# right is not fetched again, so a cache directory makes later runs quick.
#
# usage: fetch-fonts.sh <fonts.txt> <out dir> [cache dir]
set -euo pipefail

LIST=$1
OUT=$(realpath -m "$2")
CACHE=$(realpath -m "${3:-$OUT/.font-cache}")
REVISION=$(awk '$1 == "revision" {print $2}' "$LIST")
[ -n "$REVISION" ] || { echo "no revision in $LIST" >&2; exit 1; }
mkdir -p "$OUT/fonts" "$OUT/licenses/fonts" "$CACHE"

quote() { python3 -c 'import sys, urllib.parse; print(urllib.parse.quote(sys.argv[1]))' "$1"; }

grep -Ev '^(#|revision|$)' "$LIST" | while read -r sum size path; do
  kept="$CACHE/$(echo "$path" | tr '/' '_')"
  if [ ! -f "$kept" ] || [ "$(sha256sum "$kept" | cut -d' ' -f1)" != "$sum" ]; then
    case "$path" in
      aosp/*)
        # The Android source's web view gives a file as base64 text.
        curl -fsSL "https://android.googlesource.com/platform/frameworks/base/+/refs/heads/main/data/fonts/${path#aosp/}?format=TEXT" |
          base64 -d > "$kept" ;;
      *)
        curl -fsSL -o "$kept" "https://raw.githubusercontent.com/google/fonts/$REVISION/$(quote "$path")" ;;
    esac
  fi
  if [ "$(sha256sum "$kept" | cut -d' ' -f1)" != "$sum" ]; then
    echo "$path is not the file the list names (checksum differs)" >&2
    exit 1
  fi
  family=$(basename "$(dirname "$path")")
  case "$path" in
    *.ttf) cp "$kept" "$OUT/fonts/$(basename "$path")" ;;
    *)     cp "$kept" "$OUT/licenses/fonts/$family-$(basename "$path")" ;;
  esac
done

# Two families come without a licence file of their own.
cat > "$OUT/licenses/fonts/README.txt" <<'EOF'
The fonts in the "fonts" folder come from https://github.com/google/fonts and, for
Droid Sans Mono, from the Android Open Source Project.

Each family's licence is the file here that starts with its name. Two have none of
their own: Tinos is under the SIL Open Font License 1.1, the text of which is in
cousine-OFL.txt (the two were made and are published together), and Droid Sans Mono
is under the Apache License 2.0, the text of which is in comingsoon-LICENSE.txt.
EOF
echo "fonts: $(ls "$OUT/fonts" | wc -l) files, $(du -sh "$OUT/fonts" | cut -f1)"

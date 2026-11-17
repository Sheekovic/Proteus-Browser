#!/usr/bin/env bash
# Runs on the Linux build server. Builds the `chrome` target for one platform.
# usage: server-build.sh <linux|win> <jobs> <upstream-toolchain-hash> <our-toolchain-hash> [official]
#   official   the optimised build for releases (link-time optimisation), in a folder of
#              its own (out/LinuxOfficial, out/WinOfficial) next to the fast one. A first
#              build takes many hours.
set -uo pipefail

ROOT=/opt/proteus
TARGET="$1"
JOBS="$2"
FLAVOUR="${5:-}"
DONE="$ROOT/build-$TARGET${FLAVOUR:+-$FLAVOUR}.done"
rm -f "$DONE"
trap 'echo $? > "$DONE"' EXIT
set -e

export PATH="$ROOT/depot_tools:$PATH"
export DEPOT_TOOLS_UPDATE=0
export DEPOT_TOOLS_WIN_TOOLCHAIN_BASE_URL="$ROOT/win_toolchain"
export "GYP_MSVS_HASH_$3=$4"

case "$TARGET" in
  linux) OUT=out/Linux ;;
  win)   OUT=out/Win ;;
  *) echo "unknown target $TARGET" >&2; exit 2 ;;
esac

cd "$ROOT/chromium/src"
if [ "$FLAVOUR" = "official" ]; then OUT="${OUT}Official"; elif [ -n "$FLAVOUR" ]; then echo "unknown flavour $FLAVOUR" >&2; exit 2; fi
mkdir -p "$OUT"
cp "$ROOT/args.gn" "$OUT/args.gn"
if [ "$FLAVOUR" = "official" ]; then
  sed -i 's/^is_official_build = false$/is_official_build = true/' "$OUT/args.gn"
  grep -q '^is_official_build = true$' "$OUT/args.gn"
  # Profile-guided optimisation needs Google's profiles of its own builds, which do
  # not describe this one.
  echo "chrome_pgo_phase = 0" >> "$OUT/args.gn"
fi
echo "target_os = \"$TARGET\"" >> "$OUT/args.gn"

echo "== gn gen $OUT"
gn gen "$OUT"

echo "== build chrome ($TARGET, $JOBS jobs) started $(date -u +%FT%TZ)"
autoninja -j "$JOBS" -C "$OUT" chrome
echo "BUILD-OK $TARGET $(date -u +%FT%TZ)"

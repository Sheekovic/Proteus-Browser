#!/usr/bin/env bash
# Runs on the Linux build server. Applies the staged Proteus sources and edits,
# incrementally rebuilds the Linux kernel and checks patch 0004 (offline audio noise).
# usage: server-test-0004.sh <jobs>
set -uo pipefail

ROOT=/opt/proteus
STAGE="$ROOT/stage"
SRC="$ROOT/chromium/src"
DONE="$ROOT/test-0004.done"
rm -f "$DONE"
SERVER=
trap 'CODE=$?; [ -n "$SERVER" ] && kill $SERVER 2>/dev/null; echo $CODE > "$DONE"' EXIT
set -e

export PATH="$ROOT/depot_tools:$PATH"
export DEPOT_TOOLS_UPDATE=0

echo "== apply sources"
find "$STAGE" -type f \( -name '*.cc' -o -name '*.h' -o -name '*.py' -o -name '*.html' \) \
  -exec sed -i 's/\r$//' {} +
cp -r "$STAGE/src/." "$SRC/"
for script in "$STAGE"/edits/*.py; do
  python3 "$script" "$SRC" | grep -v 'already applied' || true
done

cd "$SRC"
echo "== incremental build started $(date -u +%FT%TZ)"
autoninja -j "$1" -C out/Linux chrome > "$ROOT/test-0004-build.log" 2>&1 || {
  grep -a -A30 'FAILED' "$ROOT/test-0004-build.log" | cut -c1-600 | head -120
  exit 1
}
echo "== build ok $(date -u +%FT%TZ)"

WORK=$(mktemp -d)
cp "$STAGE"/tests/*.html "$WORK/"
echo '{"seed": "1111111111111111111", "audioNoise": true}' > "$WORK/a.json"
echo '{"seed": "2222222222222222222", "audioNoise": true}' > "$WORK/b.json"
echo '{"seed": "1111111111111111111"}' > "$WORK/off.json"

python3 -m http.server 8780 --bind 127.0.0.1 --directory "$WORK" > /dev/null 2>&1 &
SERVER=$!
sleep 1

N=0
run() {  # run <page> [chrome flags...]
  N=$((N + 1))
  local page=$1; shift
  timeout 90 ./out/Linux/chrome --headless=new --no-sandbox --disable-gpu \
    --user-data-dir="$WORK/profile-$N" --virtual-time-budget=6000 "$@" \
    --dump-dom "http://127.0.0.1:8780/$page" 2>/dev/null |
    grep -o 'RESULT [^<]*' || echo "RESULT (none)"
}
field() { echo "$1" | tr ' ' '\n' | grep "^$2=" | cut -d= -f2-; }

PLAIN=$(run audio.html)
OFF=$(run audio.html --proteus-config="$WORK/off.json")
A1=$(run audio.html --proteus-config="$WORK/a.json")
A2=$(run audio.html --proteus-config="$WORK/a.json")
B=$(run audio.html --proteus-config="$WORK/b.json")
echo "plain  : $PLAIN"
echo "off    : $OFF"
echo "seed A : $A1"
echo "seed A : $A2"
echo "seed B : $B"

FAIL=0
check() { if [ "$2" = "$3" ]; then echo "ok   $1"; else echo "FAIL $1 ($2 vs $3)"; FAIL=1; fi; }
differ() { if [ "$2" != "$3" ]; then echo "ok   $1"; else echo "FAIL $1 (both $2)"; FAIL=1; fi; }

differ "offline audio works in the test"      "$(field "$PLAIN" hash)" ""
check  "noise off leaves output unchanged"    "$OFF" "$PLAIN"
check  "same seed gives identical output"     "$A1" "$A2"
for key in sum hash; do
  differ "seed A changes $key"                 "$(field "$A1" $key)" "$(field "$PLAIN" $key)"
  differ "seeds A and B differ in $key"        "$(field "$A1" $key)" "$(field "$B" $key)"
done
for r in "$PLAIN" "$A1" "$B"; do
  check "rendering twice is stable"            "$(field "$r" stable)" true
  check "copyFromChannel matches getChannelData" "$(field "$r" copy)" true
  check "constant signal untouched"            "$(field "$r" constant)" true
  check "silence untouched"                    "$(field "$r" silence)" true
done

echo "-- regressions (software rendering)"
CA=$(run canvas.html --proteus-config="$WORK/a.json")
check  "canvas unaffected by an audio-only profile" "$(field "$CA" data)" "ade7af1c"

if [ $FAIL -eq 0 ]; then echo "TEST-OK"; else echo "TEST-FAIL"; exit 1; fi

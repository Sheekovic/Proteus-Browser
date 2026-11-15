#!/usr/bin/env bash
# Runs on the Linux build server. Applies the staged Proteus sources and edits,
# incrementally rebuilds the Linux kernel and checks patch 0003 (WebGL identity and
# readPixels noise), then re-runs the canvas page to catch regressions.
# usage: server-test-0003.sh <jobs>
set -uo pipefail

ROOT=/opt/proteus
STAGE="$ROOT/stage"
SRC="$ROOT/chromium/src"
DONE="$ROOT/test-0003.done"
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
autoninja -j "$1" -C out/Linux chrome > "$ROOT/test-0003-build.log" 2>&1 || {
  grep -a -A30 'FAILED' "$ROOT/test-0003-build.log" | cut -c1-600 | head -120
  exit 1
}
echo "== build ok $(date -u +%FT%TZ)"

WORK=$(mktemp -d)
cp "$STAGE"/tests/*.html "$WORK/"
cat > "$WORK/a.json" <<'EOF'
{"seed": "1111111111111111111", "canvasNoise": true,
 "webglVendor": "Google Inc. (Intel)",
 "webglRenderer": "ANGLE (Intel, Intel(R) UHD Graphics 630 Direct3D11 vs_5_0 ps_5_0, D3D11)"}
EOF
echo '{"seed": "2222222222222222222", "canvasNoise": true}' > "$WORK/b.json"
echo '{"seed": "1111111111111111111"}' > "$WORK/off.json"

python3 -m http.server 8779 --bind 127.0.0.1 --directory "$WORK" > /dev/null 2>&1 &
SERVER=$!
sleep 1

N=0
run() {  # run <page> [chrome flags...]
  N=$((N + 1))
  local page=$1; shift
  timeout 90 ./out/Linux/chrome --headless=new --no-sandbox \
    --use-angle=swiftshader --enable-unsafe-swiftshader --ignore-gpu-blocklist \
    --user-data-dir="$WORK/profile-$N" --virtual-time-budget=5000 "$@" \
    --dump-dom "http://127.0.0.1:8779/$page" 2>/dev/null |
    grep -o 'RESULT [^<]*' || echo "RESULT (none)"
}
field() { echo "$1" | tr ' ' '\n' | grep "^$2=" | cut -d= -f2-; }

PLAIN=$(run webgl.html)
OFF=$(run webgl.html --proteus-config="$WORK/off.json")
A1=$(run webgl.html --proteus-config="$WORK/a.json")
A2=$(run webgl.html --proteus-config="$WORK/a.json")
B=$(run webgl.html --proteus-config="$WORK/b.json")
echo "plain  : $PLAIN"
echo "off    : $OFF"
echo "seed A : $A1"
echo "seed A : $A2"
echo "seed B : $B"

FAIL=0
check() { if [ "$2" = "$3" ]; then echo "ok   $1"; else echo "FAIL $1 ($2 vs $3)"; FAIL=1; fi; }
differ() { if [ "$2" != "$3" ]; then echo "ok   $1"; else echo "FAIL $1 (both $2)"; FAIL=1; fi; }

differ "WebGL is available in the test"       "$(field "$PLAIN" pixels)" ""
check  "noise off leaves output unchanged"    "$OFF" "$PLAIN"
check  "same seed gives identical output"     "$A1" "$A2"
check  "vendor string is spoofed"             "$(field "$A1" vendor)" "Google%20Inc.%20(Intel)"
check  "renderer string is spoofed" "$(field "$A1" renderer)" \
  "ANGLE%20(Intel%2C%20Intel(R)%20UHD%20Graphics%20630%20Direct3D11%20vs_5_0%20ps_5_0%2C%20D3D11)"
check  "vendor untouched when not configured" "$(field "$B" vendor)" "$(field "$PLAIN" vendor)"
for key in pixels url; do
  differ "seed A changes $key"                 "$(field "$A1" $key)" "$(field "$PLAIN" $key)"
  differ "seeds A and B differ in $key"        "$(field "$A1" $key)" "$(field "$B" $key)"
done
for r in "$PLAIN" "$A1" "$B"; do
  check "repeated reads are stable"            "$(field "$r" stable)" true
  check "sub-rectangle matches full read"      "$(field "$r" subrect)" true
  check "readPixels matches 2D copy"           "$(field "$r" match2d)" true
  check "flat framebuffer untouched"           "$(field "$r" flat)" true
done

echo "-- 2D canvas, software rendering (same setup as the patch 0002 test)"
CP=$(run canvas.html --disable-gpu)
CA=$(run canvas.html --disable-gpu --proteus-config="$WORK/a.json")
echo "plain  : $CP"
echo "seed A : $CA"
check  "baseline hash unchanged since patch 0002" "$(field "$CP" data)" "ade7af1c"
check  "seed A hash unchanged since patch 0002"   "$(field "$CA" data)" "ca85f3e5"
for key in stable subrect flat; do
  check "2D canvas $key holds"                 "$(field "$CA" $key)" true
done

# With GPU rasterisation an unmodified browser already re-renders a 2D canvas on the
# CPU after its first readback, so repeat reads differ even without Proteus. The
# noised browser must simply behave the same way as the plain one here.
echo "-- 2D canvas, GPU rendering"
GP=$(run canvas.html)
GA=$(run canvas.html --proteus-config="$WORK/a.json")
echo "plain  : $GP"
echo "seed A : $GA"
differ "noise applies"                        "$(field "$GA" data)" "$(field "$GP" data)"
for key in stable subrect flat; do
  check "2D canvas $key same as plain browser" "$(field "$GA" $key)" "$(field "$GP" $key)"
done

if [ $FAIL -eq 0 ]; then echo "TEST-OK"; else echo "TEST-FAIL"; exit 1; fi

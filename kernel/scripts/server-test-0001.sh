#!/usr/bin/env bash
# Runs on the Linux build server. Incrementally rebuilds the Linux kernel and checks
# that patch 0001 (config loader) changes what a page sees, in the main thread and in
# a worker, and that an unconfigured launch still reports the machine's real values.
# usage: server-test-0001.sh <jobs>
set -uo pipefail

ROOT=/opt/proteus
DONE="$ROOT/test-0001.done"
rm -f "$DONE"
trap 'echo $? > "$DONE"' EXIT
set -e

export PATH="$ROOT/depot_tools:$PATH"
export DEPOT_TOOLS_UPDATE=0
cd "$ROOT/chromium/src"

echo "== incremental build started $(date -u +%FT%TZ)"
autoninja -j "$1" -C out/Linux chrome > "$ROOT/test-0001-build.log" 2>&1 || {
  grep -a -A25 'FAILED' "$ROOT/test-0001-build.log" | head -80
  exit 1
}
echo "== build ok $(date -u +%FT%TZ)"

WORK=$(mktemp -d)
cat > "$WORK/index.html" <<'EOF'
<!doctype html><body><script>
const w = new Worker(URL.createObjectURL(new Blob(
  ['postMessage(navigator.hardwareConcurrency + "|" + navigator.deviceMemory)'])));
w.onmessage = e => {
  document.body.innerText = 'main=' + navigator.hardwareConcurrency + '|' +
      navigator.deviceMemory + ' worker=' + e.data;
};
</script></body>
EOF
cat > "$WORK/config.json" <<'EOF'
{"seed": "1234567890123456789", "hardwareConcurrency": 3, "deviceMemory": 2}
EOF

python3 -m http.server 8777 --bind 127.0.0.1 --directory "$WORK" > /dev/null 2>&1 &
SERVER=$!
trap 'CODE=$?; kill $SERVER 2>/dev/null; echo $CODE > "$DONE"' EXIT
sleep 1

run() {
  timeout 60 ./out/Linux/chrome --headless=new --no-sandbox --disable-gpu \
    --user-data-dir="$WORK/profile-$1" --virtual-time-budget=3000 "${@:2}" \
    --dump-dom http://127.0.0.1:8777/index.html 2>/dev/null |
    grep -o 'main=[^<]*' || echo "(no output)"
}

echo "real machine : $(nproc) cores"
echo "unconfigured : $(run plain)"
echo "configured   : $(run spoofed --proteus-config="$WORK/config.json")"

EXPECT='main=3|2 worker=3|2'
GOT=$(run spoofed2 --proteus-config="$WORK/config.json")
if [ "$GOT" = "$EXPECT" ]; then
  echo "TEST-OK"
else
  echo "TEST-FAIL expected '$EXPECT' got '$GOT'"
  exit 1
fi

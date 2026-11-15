#!/usr/bin/env bash
# Runs on the Linux build server: the manager's unit tests, then the end-to-end check
# against the real Linux kernel. Expects the archive made by push-manager-e2e.ps1 to be
# unpacked in /opt/proteus/manager-stage (manager/ and tests/).
set -uo pipefail

ROOT=/opt/proteus
STAGE="$ROOT/manager-stage"
DONE="$ROOT/e2e.done"
rm -f "$DONE"
PAGES=
trap 'CODE=$?; [ -n "$PAGES" ] && kill $PAGES 2>/dev/null; echo $CODE > "$DONE"' EXIT
set -e

# The server has no system Node; Chromium's checkout bundles one.
NODE="$ROOT/chromium/src/third_party/node/linux/node-linux-x64/bin/node"
KERNEL="$ROOT/chromium/src/out/Linux/chrome"
find "$STAGE" -type f -exec sed -i 's/\r$//' {} +

echo "== node $("$NODE" --version), kernel $("$KERNEL" --version)"
echo "== unit and API tests"
(cd "$STAGE/manager" && "$NODE" --test "test/*.test.ts" 2>&1 | tail -12)

python3 "$STAGE/tests/serve.py" "$STAGE/tests" 8791 &
PAGES=$!
sleep 1

echo "== end-to-end against the real kernel"
"$NODE" "$STAGE/manager/test/e2e/real-kernel.mjs" "$KERNEL" http://127.0.0.1:8791 \
  --headless=new --no-sandbox --disable-gpu

#!/usr/bin/env bash
# Runs kernel tests against a Windows kernel on this machine, from Git Bash.
# The same tests/<name>.test.sh files the Linux build server runs are sourced here;
# unlike there, the browser runs with its sandbox on.
# usage: win-test.sh <folder with chrome.exe> <test-name>...
set -uo pipefail

KERNEL="$(cygpath -m "$1")/chrome.exe"; shift
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
STAGE="$REPO/kernel"          # The tests refer to $STAGE/tests.
WORK=$(cygpath -m "$(mktemp -d)")
PORT=8790
python3() { python "$@"; }

cp "$STAGE"/tests/*.html "$WORK/"
python "$(cygpath -m "$STAGE/tests/serve.py")" "$WORK" $PORT &
SERVER=$!
trap 'kill $SERVER 2>/dev/null' EXIT
sleep 2

N=0
GPU_FLAGS="--disable-gpu"
VT_FLAGS="--virtual-time-budget=6000"
run() {  # run <page> [chrome flags...]  -> prints the page's RESULT line
  N=$((N + 1))
  local page=$1; shift
  timeout 90 "$KERNEL" --headless=new $GPU_FLAGS \
    --user-data-dir="$WORK/profile-$N" $VT_FLAGS "$@" \
    --dump-dom "http://127.0.0.1:$PORT/$page" 2>/dev/null |
    grep -o 'RESULT [^<]*' || echo "RESULT (none)"
}
field() { echo "$1" | tr ' ' '\n' | grep "^$2=" | cut -d= -f2-; }
FAIL=0
check() { if [ "$2" = "$3" ]; then echo "ok   $1"; else echo "FAIL $1 ($2 vs $3)"; FAIL=1; fi; }
differ() { if [ "$2" != "$3" ]; then echo "ok   $1"; else echo "FAIL $1 (both $2)"; FAIL=1; fi; }
show() { echo "$1: $(echo "$2" | tr ' ' '\n' | sed 's/^/    /')"; }

for NAME in "$@"; do
  echo "== $NAME"
  GPU_FLAGS="--disable-gpu"; VT_FLAGS="--virtual-time-budget=6000"
  . "$STAGE/tests/$NAME.test.sh"
done

if [ $FAIL -eq 0 ]; then echo "TEST-OK"; else echo "TEST-FAIL"; exit 1; fi

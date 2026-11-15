#!/usr/bin/env bash
# Runs on the Linux build server after server-fetch.sh. Installs Chromium's Linux
# build packages, then runs the gclient hooks (clang, sysroots, and the Windows
# toolchain bundle uploaded to /opt/proteus/win_toolchain).
# usage: server-prep.sh <upstream-toolchain-hash> <our-toolchain-hash>
set -uo pipefail

ROOT=/opt/proteus
DONE="$ROOT/prep.done"
rm -f "$DONE"
trap 'echo $? > "$DONE"' EXIT
set -e

export PATH="$ROOT/depot_tools:$PATH"
export DEPOT_TOOLS_UPDATE=0
export DEBIAN_FRONTEND=noninteractive
export DEPOT_TOOLS_WIN_TOOLCHAIN_BASE_URL="$ROOT/win_toolchain"
export "GYP_MSVS_HASH_$1=$2"

cd "$ROOT/chromium/src"

echo "== install-build-deps"
./build/install-build-deps.sh --no-prompt --no-arm --no-chromeos-fonts

echo "== gclient runhooks"
gclient runhooks

echo "PREP-OK"

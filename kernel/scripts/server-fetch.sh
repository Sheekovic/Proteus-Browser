#!/usr/bin/env bash
# Runs on the Linux build server. Fetches the pinned Chromium release (no git
# history, hooks deferred) into /opt/proteus/chromium/src with Windows deps included.
# usage: server-fetch.sh <chromium-version>
set -euo pipefail

ROOT=/opt/proteus
VERSION="$1"

mkdir -p "$ROOT/chromium"
if [ ! -d "$ROOT/depot_tools" ]; then
  git clone --quiet https://chromium.googlesource.com/chromium/tools/depot_tools.git "$ROOT/depot_tools"
fi
export PATH="$ROOT/depot_tools:$PATH"
export DEPOT_TOOLS_UPDATE=0

cd "$ROOT/chromium"
cat > .gclient <<'EOF'
solutions = [
  {
    "name": "src",
    "url": "https://chromium.googlesource.com/chromium/src.git",
    "managed": False,
    "custom_deps": {},
    "custom_vars": {},
  },
]
target_os = ["win"]
EOF

echo "Syncing Chromium $VERSION (hooks deferred) ..."
gclient sync --nohooks --no-history --delete_unversioned_trees \
  --revision "src@refs/tags/$VERSION"
echo "FETCH-OK $VERSION"

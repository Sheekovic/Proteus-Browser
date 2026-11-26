#!/usr/bin/env bash
# Assembles the release bundles on the build server from kernels that are already
# built (out/Win and out/Linux) and from the staged repository files.
#
# Each bundle is one folder that runs as it is: the kernel, the manager, and the
# Node.js runtime the manager needs.
#
#   Proteus-<version>-win-x64.zip
#   Proteus-<version>-linux-x64.tar.xz
#   SHA256SUMS.txt
#
# usage: package.sh <version> <stage dir> <output dir> [official]
#   <stage dir> holds manager/, release/ and LICENSE from the repository.
#   official    take the optimised kernels (out/WinOfficial and out/LinuxOfficial, see
#               server-build.sh) instead of the fast ones
set -euo pipefail

VERSION=$1
STAGE=$(realpath "$2")
OUT=$(realpath -m "$3")
FLAVOUR=${4:-}
SRC=/opt/proteus/chromium/src
case "$FLAVOUR" in
  "")       KERNEL_WIN="$SRC/out/Win";         KERNEL_LIN="$SRC/out/Linux" ;;
  official) KERNEL_WIN="$SRC/out/WinOfficial"; KERNEL_LIN="$SRC/out/LinuxOfficial" ;;
  *) echo "unknown flavour $FLAVOUR" >&2; exit 2 ;;
esac
[ -f "$KERNEL_WIN/chrome.exe" ] && [ -f "$KERNEL_LIN/chrome" ] && [ -f "$KERNEL_WIN/chromedriver.exe" ] && [ -f "$KERNEL_LIN/chromedriver" ] || { echo "there is no built kernel in $KERNEL_WIN and $KERNEL_LIN" >&2; exit 1; }
echo "kernels: $KERNEL_WIN, $KERNEL_LIN"
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
mkdir -p "$OUT"
rm -f "$OUT"/Proteus-*"$VERSION"* "$OUT/SHA256SUMS.txt"

# --- Node.js: the newest 24.x release, checked against the checksums published with it.
NODE_DIST=https://nodejs.org/dist/latest-v24.x
curl -fsSL "$NODE_DIST/SHASUMS256.txt" -o "$WORK/SHASUMS256.txt"
node_file() {  # node_file <suffix>  -> downloads and verifies, prints the path
  local name
  name=$(grep -E " node-v24\.[0-9.]+-$1\$" "$WORK/SHASUMS256.txt" | awk '{print $2}')
  [ -n "$name" ] || { echo "no Node.js build for $1" >&2; exit 1; }
  curl -fsSL "$NODE_DIST/$name" -o "$WORK/$name"
  (cd "$WORK" && grep " $name\$" SHASUMS256.txt | sha256sum -c --quiet -)
  echo "$WORK/$name"
}

# --- What both bundles share.
common() {  # common <bundle dir>
  local dir=$1
  mkdir -p "$dir/manager" "$dir/kernel" "$dir/node" "$dir/licenses"
  cp -r "$STAGE/manager/src" "$STAGE/manager/ui" "$STAGE/manager/package.json" "$dir/manager/"
  cp "$STAGE/LICENSE" "$dir/LICENSE.txt"
  sed "s/@VERSION@/$VERSION/g" "$STAGE/release/README.txt" > "$dir/README.txt"
  cp "$SRC/LICENSE" "$dir/licenses/Chromium-LICENSE.txt"
  # Licences of what the manager includes (the readings its identities are drawn from).
  cp "$STAGE/manager/licenses/"* "$dir/licenses/"
  # The fonts that come with Proteus, each checked against release/fonts.txt, and
  # their licences (fetched once; later runs take them from the cache).
  bash "$STAGE/release/fetch-fonts.sh" "$STAGE/release/fonts.txt" "$dir" /opt/proteus/fonts-cache/files
  # Which version this folder is: the manager reads it when asked whether there is a newer one.
  echo "$VERSION" > "$dir/VERSION.txt"
}

# --- Windows
WIN="$WORK/win/Proteus"
common "$WIN"
(cd "$KERNEL_WIN" && cp --parents chrome.exe chromedriver.exe chrome.dll chrome_elf.dll chrome_wer.dll ./*.pak icudtl.dat \
    snapshot_blob.bin ./*.manifest d3dcompiler_47.dll dxcompiler.dll libEGL.dll libGLESv2.dll \
    vk_swiftshader.dll vk_swiftshader_icd.json vulkan-1.dll msvcp140*.dll vcruntime140*.dll \
    vccorlib140.dll locales/*.pak "$WIN/kernel/")
cp -r "$KERNEL_WIN/MEIPreload" "$WIN/kernel/"
NODE_WIN=$(node_file "win-x64.zip")
unzip -q "$NODE_WIN" -d "$WORK/node-win"
cp "$WORK"/node-win/node-*/node.exe "$WIN/node/"
cp "$WORK"/node-win/node-*/LICENSE "$WIN/licenses/Node.js-LICENSE.txt"
# CRLF line endings, as Windows' command interpreter expects.
sed 's/\r$//; s/$/\r/' "$STAGE/release/Start Proteus.cmd" > "$WIN/Start Proteus.cmd"
sed 's/\r$//; s/$/\r/' "$STAGE/release/Install Proteus.cmd" > "$WIN/Install Proteus.cmd"
sed 's/\r$//; s/$/\r/' "$STAGE/release/install.ps1" > "$WIN/install.ps1"
# The icon of the shortcuts an install makes.
cp "$STAGE/branding/proteus.ico" "$WIN/proteus.ico"
(cd "$WORK/win" && zip -q -r -9 "$OUT/Proteus-$VERSION-win-x64.zip" Proteus)

# --- Linux
LIN="$WORK/linux/Proteus"
common "$LIN"
(cd "$KERNEL_LIN" && cp --parents chrome chromedriver chrome_crashpad_handler ./*.pak icudtl.dat v8_context_snapshot.bin \
    libEGL.so libGLESv2.so libvk_swiftshader.so vk_swiftshader_icd.json libvulkan.so.1 \
    locales/*.pak "$LIN/kernel/")
[ -d "$KERNEL_LIN/MEIPreload" ] && cp -r "$KERNEL_LIN/MEIPreload" "$LIN/kernel/"
rm -f "$LIN/kernel/headless_command_resources.pak"
strip --strip-unneeded "$LIN/kernel/chrome" "$LIN/kernel/chromedriver" "$LIN/kernel/chrome_crashpad_handler" "$LIN"/kernel/*.so "$LIN/kernel/libvulkan.so.1"
NODE_LIN=$(node_file "linux-x64.tar.xz")
mkdir "$WORK/node-linux"
tar -xJf "$NODE_LIN" -C "$WORK/node-linux"
cp "$WORK"/node-linux/node-*/bin/node "$LIN/node/"
cp "$WORK"/node-linux/node-*/LICENSE "$LIN/licenses/Node.js-LICENSE.txt"
sed 's/\r$//' "$STAGE/release/start-proteus.sh" > "$LIN/start-proteus.sh"
sed 's/\r$//' "$STAGE/release/linux-sandbox.sh" > "$LIN/linux-sandbox.sh"
chmod +x "$LIN/start-proteus.sh" "$LIN/linux-sandbox.sh" "$LIN/kernel/chrome" "$LIN/kernel/chromedriver" "$LIN/kernel/chrome_crashpad_handler" "$LIN/node/node"
(cd "$WORK/linux" && tar -cf - Proteus | xz -T0 -6 > "$OUT/Proteus-$VERSION-linux-x64.tar.xz")

(cd "$OUT" && sha256sum Proteus-"$VERSION"-* > SHA256SUMS.txt && cat SHA256SUMS.txt && ls -la)

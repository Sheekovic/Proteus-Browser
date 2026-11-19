#!/usr/bin/env bash
# Runs on the Linux build server, started by make-release.ps1. Turns the staged
# repository into release bundles in one go:
#
#   1. applies the staged kernel sources and edits, rebuilds the Linux kernel and
#      runs every kernel test on it;
#   2. records kernel changes that are not committed yet as one commit in the Chromium
#      checkout and exports the whole patch series;
#   3. builds the Windows kernel;
#   4. assembles the bundles (package.sh).
#
# A failing step stops the run: no bundle is made from a kernel that failed a test.
#
# usage: server-release.sh <version> <jobs> [commit message for uncommitted kernel changes]
#   /opt/proteus/stage          kernel src/, tests/, edits/  (as push-and-test.ps1 stages them)
#   /opt/proteus/release-stage  manager/, release/, LICENSE
# Writes /opt/proteus/release.log (by its caller), release-tests.log and, when
# finished, release.done holding the exit code. Bundles land in /opt/proteus/release-out.
set -uo pipefail

ROOT=/opt/proteus
VERSION=$1
JOBS=$2
MESSAGE=${3:-}
SRC="$ROOT/chromium/src"
# The commit the patch series starts from, and the Windows toolchain package the
# cross-build uses (upstream's hash, and the hash of the package made on this server).
BASE_COMMIT=6dc9bc3bda
# BoringSSL is a repository of its own inside the checkout (third_party/boringssl/src),
# with patches of its own: the commit Chromium pins, which they start from.
BORINGSSL=third_party/boringssl/src
BORINGSSL_BASE=5b83e5d1ab
TOOLCHAIN_UPSTREAM=3bfcb536c8
TOOLCHAIN_OURS=e1fc4eb033

rm -f "$ROOT/release.done"
trap 'echo $? > "$ROOT/release.done"' EXIT
set -e
cd "$ROOT"

echo "== 1. Linux kernel and its tests  $(date -u +%FT%TZ)"
: > release-tests.log
FAILED=0
for file in stage/tests/*.test.sh; do
  name=$(basename "$file" .test.sh)
  [ "$name" = "fonts-win" ] && continue          # Needs Windows' fonts.
  # The first run applies the sources and rebuilds; the others find nothing to build.
  if ./server-test.sh "$name" "$JOBS" > "release-test-$name.log" 2>&1; then result=ok; else result=FAILED; FAILED=1; fi
  echo "$name $result ok=$(grep -ac '^ok' "release-test-$name.log") fail=$(grep -ac '^FAIL' "release-test-$name.log")" | tee -a release-tests.log
  grep -a '^FAIL\|EDIT-FAILED' "release-test-$name.log" | cut -c1-200 | tee -a release-tests.log || true
  if grep -aq 'EDIT-FAILED\|^FAILED:' "release-test-$name.log"; then
    # The kernel itself did not build: the remaining tests would only repeat that.
    grep -a -A20 '^FAILED:' "release-test-$name.log" | cut -c1-400 | head -60
    exit 1
  fi
done
[ $FAILED -eq 0 ] || { echo "kernel tests failed: no release"; exit 1; }

echo "== 2. patch series  $(date -u +%FT%TZ)"
cd "$SRC"
G="git -c user.name=Proteus -c user.email=proteus@localhost"
git add -A -- $(cd "$ROOT/stage/src" && find . -type f | sed 's|^\./||')
# Not BoringSSL's pointer: its changes are commits in its own repository, exported below.
git add -u -- . ":(exclude)$BORINGSSL"
if [ -n "$(git -C "$BORINGSSL" status --short --untracked-files=no)" ]; then
  [ -n "$MESSAGE" ] || { echo "BoringSSL has uncommitted changes: give a commit message"; exit 1; }
  git -C "$BORINGSSL" add -u
  $G -C "$BORINGSSL" commit -q -m "proteus: $MESSAGE"
fi
if ! git diff --cached --quiet; then
  [ -n "$MESSAGE" ] || { echo "the kernel has uncommitted changes: give a commit message"; exit 1; }
  $G commit -q -m "proteus: $MESSAGE"
fi
git log --oneline -3
rm -rf "$ROOT/patches" && mkdir -p "$ROOT/patches/boringssl"
$G format-patch -q "$BASE_COMMIT" -o "$ROOT/patches"
$G -C "$BORINGSSL" format-patch -q "$BORINGSSL_BASE" -o "$ROOT/patches/boringssl"
tar -cf "$ROOT/patches.tar" -C "$ROOT/patches" .
echo "patches: $(ls "$ROOT/patches"/*.patch | wc -l), for BoringSSL: $(ls "$ROOT/patches/boringssl" | wc -l)"

echo "== 3. Windows kernel  $(date -u +%FT%TZ)"
cd "$ROOT"
bash ./server-build.sh win "$JOBS" "$TOOLCHAIN_UPSTREAM" "$TOOLCHAIN_OURS" > build-win.log 2>&1 || true
if [ "$(cat build-win.done)" != "0" ]; then
  grep -a -A14 'FAILED' build-win.log | cut -c1-500 | head -60
  exit 1
fi

echo "== 4. bundles  $(date -u +%FT%TZ)"
sed -i 's/\r$//' release-stage/release/*.sh release-stage/release/README.txt
bash release-stage/release/package.sh "$VERSION" "$ROOT/release-stage" "$ROOT/release-out"
echo "RELEASE-OK $VERSION $(date -u +%FT%TZ)"

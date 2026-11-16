#!/bin/sh
# Starts the Proteus manager and opens it in your browser.
# Keep this terminal open while you use Proteus; Ctrl+C stops the running profiles.
here=$(cd "$(dirname "$0")" && pwd)
if ! "$here/linux-sandbox.sh" --check; then
  echo "Before profiles can start, this system needs one change so that the browser"
  echo "can use its sandbox. Run this once, then start Proteus again:"
  echo
  echo "    sudo \"$here/linux-sandbox.sh\" --install"
  echo
  echo "(It adds an AppArmor profile for the browser in this folder; see the file.)"
  echo
fi
exec "$here/node/node" "$here/manager/src/main.ts" --open "$@"

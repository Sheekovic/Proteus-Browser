#!/bin/sh
# Starts the Proteus manager and opens it in your browser.
# Keep this terminal open while you use Proteus; Ctrl+C stops the running profiles.
here=$(cd "$(dirname "$0")" && pwd)
exec "$here/node/node" "$here/manager/src/main.ts" --open "$@"

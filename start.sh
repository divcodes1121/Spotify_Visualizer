#!/usr/bin/env sh
# Aura launcher for macOS / Linux
cd "$(dirname "$0")" || exit 1
command -v node >/dev/null 2>&1 || { echo "Node.js is required: https://nodejs.org"; exit 1; }
[ -f test-media/images/neon-tide.png ] || node tools/generate-test-media.js
exec node server.js --open

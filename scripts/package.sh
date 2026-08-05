#!/bin/sh
# Builds the Chrome Web Store upload zip: dist/socialfix-<version>.zip
# Contains ONLY what the extension needs at runtime (manifest, popup, styles,
# content scripts, icons) — no docs, no PDFs, no git metadata.
set -e
cd "$(dirname "$0")/.."

node -e "JSON.parse(require('fs').readFileSync('manifest.json','utf8'))"
for f in src/*.js popup.js; do node --check "$f"; done

VERSION=$(node -p "require('./manifest.json').version")
mkdir -p dist
ZIP="dist/socialfix-$VERSION.zip"
rm -f "$ZIP"
zip -q -r -X "$ZIP" manifest.json popup.html popup.js styles.css src icons -x "*.DS_Store"
echo "built $ZIP"
unzip -l "$ZIP"

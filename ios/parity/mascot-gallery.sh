#!/bin/sh
# Renders the mascot gallery on both sides for a visual comparison:
#   desktop-<page>.png  from the desktop components (headless Chrome)
#   ios-<page>.png      from the phone's DEBUG gallery in a simulator
#
#   ios/parity/mascot-gallery.sh <out-dir> [simulator-udid]
#
# Without a UDID only the desktop half runs. The iOS half expects the app to
# be built for the simulator already (xcodebuild ... -derivedDataPath <dd>)
# and DERIVED_DATA to point at that derived data path.
set -eu
out=${1:?usage: mascot-gallery.sh <out-dir> [simulator-udid]}
udid=${2:-}
here=$(cd "$(dirname "$0")" && pwd)
repo=$(cd "$here/../.." && pwd)
mkdir -p "$out"
out=$(cd "$out" && pwd)

cp "$here/mascot-gallery.render.ts" "$repo/src/zz-mascot-gallery.test.ts"
trap 'rm -f "$repo/src/zz-mascot-gallery.test.ts"' EXIT
(cd "$repo" && MASCOT_GALLERY_OUT="$out" npx vitest run src/zz-mascot-gallery.test.ts >/dev/null)

chrome="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
for page in owl shape shape-set shape-skins shape-own trombi group; do
  "$chrome" --headless --disable-gpu --hide-scrollbars --force-device-scale-factor=3 \
    --window-size=402,874 --screenshot="$out/desktop-$page.png" "file://$out/desktop-$page.html" >/dev/null 2>&1
done

[ -n "$udid" ] || exit 0
app=$(find "${DERIVED_DATA:?}/Build/Products/Debug-iphonesimulator" -maxdepth 1 -name "*.app" | head -1)
bundle=$(/usr/libexec/PlistBuddy -c "Print CFBundleIdentifier" "$app/Info.plist")
xcrun simctl install "$udid" "$app"
for page in owl shape shape-set shape-skins shape-own trombi group; do
  xcrun simctl terminate "$udid" "$bundle" 2>/dev/null || true
  xcrun simctl launch "$udid" "$bundle" -mascotGallery "$page" >/dev/null
  sleep 3
  xcrun simctl io "$udid" screenshot "$out/ios-$page.png" >/dev/null 2>&1
done

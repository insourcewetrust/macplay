#!/bin/bash
# Build MacPlay.app: compile the SwiftUI executable, bundle it with the
# Python engine + games DB in Resources/engine, ad-hoc sign.
set -euo pipefail
cd "$(dirname "$0")"

swift build -c release

APP="dist/MacPlay.app"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources/engine/data"

cp .build/release/MacPlay "$APP/Contents/MacOS/MacPlay"
# engine is fully native Swift now; only the games DB ships as a resource
cp ../data/games.json "$APP/Contents/Resources/engine/data/"

cat > "$APP/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleExecutable</key><string>MacPlay</string>
  <key>CFBundleIdentifier</key><string>com.macplay.app</string>
  <key>CFBundleName</key><string>MacPlay</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>0.1.0</string>
  <key>CFBundleVersion</key><string>1</string>
  <key>LSMinimumSystemVersion</key><string>13.0</string>
  <key>NSHighResolutionCapable</key><true/>
  <key>NSAppTransportSecurity</key>
  <dict>
    <!-- allow plain HTTP to localhost/local addresses (dev hub);
         production hub is HTTPS on a real domain -->
    <key>NSAllowsLocalNetworking</key><true/>
  </dict>
  <key>NSHumanReadableCopyright</key><string>MacPlay prototype</string>
</dict>
</plist>
PLIST

codesign --force --deep -s - "$APP"
echo "OK: $APP"

#!/usr/bin/env bash
# Build a signed Fuseau APK without Gradle, using the Debian/Ubuntu Android tools:
#   sudo apt-get install aapt apksigner zipalign dalvik-exchange android-sdk-platform-23
# Output: jetlag/release/fuseau.apk
set -euo pipefail
cd "$(dirname "$0")"
ROOT="$(cd .. && pwd)"
SDK_JAR="${ANDROID_JAR:-/usr/lib/android-sdk/platforms/android-23/android.jar}"
VERSION_NAME="$(node -p "require('$ROOT/package.json').version")"
VERSION_CODE="${VERSION_CODE:-$(git -C "$ROOT" rev-list --count HEAD 2>/dev/null || echo 1)}"
KS="${KEYSTORE:-$PWD/fuseau.keystore}"
KS_PASS="${KEYSTORE_PASS:-fuseau-android}"
OUT=build

rm -rf "$OUT" && mkdir -p "$OUT/assets/web" "$OUT/classes" "$ROOT/release"

echo "› Web app (single file)"
(cd "$ROOT" && npm run --silent build:single >/dev/null)
cp "$ROOT/dist-single/index.html" "$OUT/assets/web/index.html"

if [ ! -f "$KS" ]; then
  echo "› Creating signing key $KS"
  keytool -genkeypair -keystore "$KS" -storepass "$KS_PASS" -keypass "$KS_PASS" -alias fuseau \
    -keyalg RSA -keysize 3072 -validity 36500 -dname "CN=Fuseau, O=Fuseau, C=FR" >/dev/null 2>&1
fi

echo "› Resources"
aapt package -f -M AndroidManifest.xml -S res -A "$OUT/assets" -I "$SDK_JAR" \
  --min-sdk-version 23 --target-sdk-version 34 \
  --version-code "$VERSION_CODE" --version-name "$VERSION_NAME" \
  -0 arsc -F "$OUT/unsigned.apk"

echo "› Java"
javac -nowarn -Xlint:-options --release 8 -encoding UTF-8 -classpath "$SDK_JAR" -d "$OUT/classes" $(find src -name '*.java')
dalvik-exchange --dex --min-sdk-version=23 --output="$OUT/classes.dex" "$OUT/classes"
(cd "$OUT" && aapt add -f unsigned.apk classes.dex >/dev/null)

echo "› Align + sign"
zipalign -f -p 4 "$OUT/unsigned.apk" "$OUT/aligned.apk"
apksigner sign --ks "$KS" --ks-pass "pass:$KS_PASS" --ks-key-alias fuseau \
  --min-sdk-version 23 --v1-signing-enabled true --v2-signing-enabled true --v3-signing-enabled true --v4-signing-enabled false \
  --out "$ROOT/release/fuseau.apk" "$OUT/aligned.apk"
apksigner verify "$ROOT/release/fuseau.apk"
ls -la "$ROOT/release/fuseau.apk"

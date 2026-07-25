#!/usr/bin/env bash
#
# Construit l'APK de 301 sans le SDK Android.
#
# Google Maven n'est pas toujours accessible ; toute la chaîne vient donc de
# Maven Central : dx (dexer), ARSCLib (manifeste binaire + resources.arsc),
# apksig (signature v2/v3) et les stubs android.jar pour la compilation.
#
# Prérequis : un JDK (javac/java/keytool) et python3. Rien d'autre.
#
#   ./build.sh              → android/out/301-flechettes.apk
#   VERSION_CODE=2 VERSION_NAME=1.1 ./build.sh

set -euo pipefail

cd "$(dirname "$0")"
ROOT=$(pwd)
TOOLS="$ROOT/tools"
BUILD="$ROOT/build"
OUT="$ROOT/out"
ASSETS="$BUILD/assets"

VERSION_CODE=${VERSION_CODE:-1}
VERSION_NAME=${VERSION_NAME:-1.0}
APK_NAME=${APK_NAME:-301-flechettes.apk}

MAVEN=https://repo1.maven.org/maven2
DX_VER=16.0.1
ARSC_VER=1.4.0
APKSIG_VER=2.3.0
STUBS_VER=4.1.1.4

fetch() { # url, destination
  if [ ! -f "$2" ]; then
    echo "→ téléchargement $(basename "$2")"
    curl -sSfL --max-time 300 -o "$2" "$1"
  fi
}

echo "== 1/6  outils =="
mkdir -p "$TOOLS"
fetch "$MAVEN/com/jakewharton/android/repackaged/dalvik-dx/$DX_VER/dalvik-dx-$DX_VER.jar" "$TOOLS/dalvik-dx.jar"
fetch "$MAVEN/io/github/reandroid/ARSCLib/$ARSC_VER/ARSCLib-$ARSC_VER.jar" "$TOOLS/arsclib.jar"
fetch "$MAVEN/com/android/tools/build/apksig/$APKSIG_VER/apksig-$APKSIG_VER.jar" "$TOOLS/apksig.jar"
fetch "$MAVEN/com/google/android/android/$STUBS_VER/android-$STUBS_VER.jar" "$TOOLS/android-stubs.jar"

rm -rf "$BUILD"
mkdir -p "$BUILD/classes" "$ASSETS" "$OUT"

echo "== 2/6  application web → assets/ =="
cp -R "$ROOT/../public/." "$ASSETS/"
find "$ASSETS" -name '.DS_Store' -delete

echo "== 3/6  compilation Java → classes.dex =="
javac --release 8 -nowarn \
      -classpath "$TOOLS/android-stubs.jar" \
      -d "$BUILD/classes" \
      $(find "$ROOT/src" -name '*.java')
java -cp "$TOOLS/dalvik-dx.jar" com.android.dx.command.Main \
     --dex --min-sdk-version=24 --output="$BUILD/classes.dex" "$BUILD/classes"

echo "== 4/6  icône, manifeste et resources.arsc =="
python3 "$TOOLS/make_icon.py" "$BUILD/ic_launcher.png" 432
javac -nowarn -classpath "$TOOLS/arsclib.jar" -d "$BUILD" "$TOOLS/BuildApk.java"
java -cp "$TOOLS/arsclib.jar:$BUILD" BuildApk "$BUILD" "$VERSION_CODE" "$VERSION_NAME"

echo "== 5/6  assemblage =="
python3 "$TOOLS/pack.py" "$BUILD" "$ASSETS" "$BUILD/unsigned.apk"

echo "== 6/6  signature =="
KEYSTORE="$ROOT/keystore.p12"
KEYPASS=${KEYPASS:-darts301}
if [ ! -f "$KEYSTORE" ]; then
  echo "→ création d'une clé de signature locale"
  keytool -genkeypair -storetype PKCS12 -keystore "$KEYSTORE" \
          -storepass "$KEYPASS" -keypass "$KEYPASS" -alias darts301 \
          -keyalg RSA -keysize 2048 -validity 10950 \
          -dname "CN=301 Flechettes, OU=MacPlay, O=MacPlay, C=FR" >/dev/null 2>&1
fi
javac -nowarn -classpath "$TOOLS/apksig.jar" -d "$BUILD" "$TOOLS/SignApk.java"
# apksig publié sur Maven Central date d'avant le système de modules : il touche
# sun.security.x509, qu'il faut rouvrir explicitement sur un JDK 9+.
EXPORTS=""
if java --add-exports java.base/sun.security.x509=ALL-UNNAMED -version >/dev/null 2>&1; then
  EXPORTS="--add-exports java.base/sun.security.x509=ALL-UNNAMED"
  EXPORTS="$EXPORTS --add-exports java.base/sun.security.pkcs=ALL-UNNAMED"
  EXPORTS="$EXPORTS --add-exports java.base/sun.security.util=ALL-UNNAMED"
fi
java $EXPORTS -cp "$TOOLS/apksig.jar:$BUILD" SignApk \
     "$KEYSTORE" "$KEYPASS" darts301 "$BUILD/unsigned.apk" "$OUT/$APK_NAME"

echo
echo "✅  $OUT/$APK_NAME"

#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
if [[ ! -f public/offline/version.json ]]; then
    echo 'Build the HNS engine first: npm run build:engine (with emsdk activated).' >&2
    exit 1
fi
npm run build
cd android
./gradlew --no-daemon :app:assembleDebug
echo "APK: $PWD/app/build/outputs/apk/debug/app-debug.apk"

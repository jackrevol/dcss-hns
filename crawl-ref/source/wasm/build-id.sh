#!/bin/sh
# Hash every cached engine and tile artifact. Art-only changes must invalidate
# gamedata too; the client keys BOTH stores on this one content-derived id.
set -e
set -- wasm/dist/crawl.wasm wasm/dist/crawl.data wasm/dist/crawl.js
if [ -f wasm/dist/prewarm/prewarm.bin ]; then
    set -- "$@" wasm/dist/prewarm/manifest.json wasm/dist/prewarm/prewarm.bin
fi
if [ -f wasm/dist-jspi/crawl.wasm ]; then
    set -- "$@" wasm/dist-jspi/crawl.wasm wasm/dist-jspi/crawl.js
fi
for tex in feat floor gui icons main player wall; do
    set -- "$@" "webserver/game_data/static/$tex.png" \
        "webserver/game_data/static/tileinfo-$tex.js"
done
set -- "$@" webserver/game_data/static/enums.js \
    webserver/game_data/static/tileinfo-dngn.js \
    webserver/game_data/static/status-icon-sizes.js
for file in "$@"; do
    [ -f "$file" ] || { echo "missing artifact: $file" >&2; exit 1; }
done
shasum "$@" | shasum | cut -c1-12

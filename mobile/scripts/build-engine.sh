#!/usr/bin/env bash
set -euo pipefail
mobile_dir="$(cd "$(dirname "$0")/.." && pwd)"
repo_dir="$(cd "$mobile_dir/.." && pwd)"
for tool in emcc em++ node python3 make; do
    command -v "$tool" >/dev/null || { echo "Missing build tool: $tool" >&2; exit 1; }
done
python3 -c 'import yaml'
if [[ -e "$repo_dir/.git" ]]; then
    git -C "$repo_dir" submodule update --init -- crawl-ref/source/contrib/lua crawl-ref/source/contrib/fonts
elif [[ ! -f "$repo_dir/crawl-ref/source/contrib/lua/src/lua.h" ]]; then
    echo 'Missing Lua sources; use the complete source archive or a Git checkout.' >&2
    exit 1
fi
cd "$repo_dir/crawl-ref/source"
export HNS_RELEASE_VERSION="$(node "$mobile_dir/scripts/release-version.mjs")"
export HNS_ENGINE_VERSION="$HNS_RELEASE_VERSION"
make -j"${JOBS:-8}" WEBTILES=1 BUILD_LUA=1 FORCE_PKGCONFIG=1 SRC_VERSION="$HNS_RELEASE_VERSION"
sh wasm/gen-objects.sh
make -f wasm/Makefile.emscripten -j"${JOBS:-8}"
if [[ "${WASM_JSPI:-0}" == 1 ]]; then
    make -f wasm/Makefile.emscripten VARIANT=jspi -j"${JOBS:-8}"
fi
node wasm/bake-caches.mjs
sh wasm/install.sh "$mobile_dir"

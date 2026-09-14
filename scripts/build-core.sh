#!/usr/bin/env bash
#
# Compiles wabt's wasm2c to WebAssembly and drops the result into src/core/.
#
# Requires the Emscripten SDK. Point EMSDK at your install (the default is
# ~/emsdk) or have emcc already on PATH.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
build_dir="${BUILD_DIR:-$root/build/core}"
out_dir="$root/src/core"

if ! command -v emcc >/dev/null 2>&1; then
  emsdk_dir="${EMSDK:-$HOME/emsdk}"
  if [ -f "$emsdk_dir/emsdk_env.sh" ]; then
    # shellcheck disable=SC1091
    source "$emsdk_dir/emsdk_env.sh" >/dev/null
  else
    echo "error: emcc not found and no emsdk_env.sh at $emsdk_dir" >&2
    echo "       install the Emscripten SDK: https://emscripten.org/docs/getting_started/downloads.html" >&2
    exit 1
  fi
fi

cmake_args=(-S "$root/native" -B "$build_dir" -G Ninja -DCMAKE_BUILD_TYPE=Release)
if [ -n "${WABT_DIR:-}" ]; then
  cmake_args+=("-DWABT_DIR=$WABT_DIR")
fi

emcmake cmake "${cmake_args[@]}"
cmake --build "$build_dir" --target wasm2c

mkdir -p "$out_dir"
cp "$build_dir/wasm2c.js" "$out_dir/wasm2c.js"
cp "$build_dir/wasm2c.wasm" "$out_dir/wasm2c.wasm"

# wasm2c's generated code is written against these; the playground shows them
# so you can follow an #include or look up a wasm_rt_* type. Vendored (with
# their Apache-2.0 headers intact) so the app builds without the submodule.
runtime_src="${WABT_DIR:-$root/third_party/wabt}/wasm2c"
runtime_out="$out_dir/runtime"
mkdir -p "$runtime_out"
rm -f "$runtime_out"/*.h "$runtime_out"/*.c "$runtime_out"/*.inc
for f in wasm-rt.h wasm-rt-impl.h wasm-rt-impl.c wasm-rt-impl-tableops.inc \
         wasm-rt-mem-impl.c wasm-rt-mem-impl-helper.inc \
         wasm-rt-exceptions.h wasm-rt-exceptions-impl.c; do
  cp "$runtime_src/$f" "$runtime_out/$f"
done

# Record which wabt revision produced these artifacts, so the UI can show it.
wabt_dir="${WABT_DIR:-$root/third_party/wabt}"
revision="$(git -C "$wabt_dir" rev-parse --short HEAD 2>/dev/null || echo unknown)"
described="$(git -C "$wabt_dir" describe --tags --always 2>/dev/null || echo unknown)"
cat > "$out_dir/wabt-version.json" <<JSON
{
  "revision": "$revision",
  "describe": "$described",
  "builtAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
JSON

echo
echo "wrote $out_dir/wasm2c.js  ($(wc -c < "$out_dir/wasm2c.js" | tr -d ' ') bytes)"
echo "wrote $out_dir/wasm2c.wasm ($(wc -c < "$out_dir/wasm2c.wasm" | tr -d ' ') bytes)"
echo "wrote $runtime_out/ ($(ls "$runtime_out" | wc -l | tr -d ' ') runtime files)"
echo "wabt revision: $described"

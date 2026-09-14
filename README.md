# wasm2c playground

Type WebAssembly in the browser and watch [wabt](https://github.com/WebAssembly/wabt)'s
`wasm2c` turn it into C, live.

Everything runs client-side: wabt itself is compiled to WebAssembly, so there is
no backend, nothing is uploaded, and the site is a pile of static files.

## What it does

- **Live conversion.** The WAT you type is assembled and run through `wasm2c`
  on every edit (debounced, off the main thread). The generated `.c` and `.h`
  appear beside it.
- **Real diagnostics.** wabt's own error output, carets and all, with the
  offending range underlined in the editor. A broken edit doesn't wipe out the
  C you were reading — it's dimmed and marked stale until the module parses
  again.
- **The actual wasm2c options.** Module name (`-n`), number of output files
  (`--num-outputs`, which adds the shared `-impl.h`), debug names, and the
  feature flags wasm2c accepts.
- **Shareable links.** The Share button packs the module and options into the
  URL fragment, deflated.
- **The binary too.** The assembled `.wasm` is downloadable from the status bar.

## Running it

```sh
npm install
npm run dev
```

The compiled wasm2c core is committed under `src/core/`, so this needs nothing
but Node.

## Rebuilding the core

`src/core/wasm2c.wasm` is wabt compiled by Emscripten. You only need to rebuild
it to pick up a newer wabt or to change the bindings in
`native/wasm2c_bindings.cc`.

```sh
git submodule update --init --recursive third_party/wabt
./scripts/build-core.sh
```

It needs the [Emscripten SDK](https://emscripten.org/docs/getting_started/downloads.html);
the script sources `~/emsdk/emsdk_env.sh` if `emcc` isn't already on `PATH`, or
set `EMSDK` to point elsewhere. To build against a wabt checkout you already
have, pass `WABT_DIR=/path/to/wabt`.

The build emits one artifact that runs in browsers, workers, and Node. The Node
support is what lets `npm run test:core` run without Emscripten installed; it
costs a guarded dynamic `import('node:module')` that Vite reports as
externalized at build time, and that branch never executes in a browser.

## Tests

```sh
npm run test:core     # the wasm2c core, in Node
npm run test:browser  # the built page, in Chromium (npx playwright install chromium)
npm test              # both
```

`test:core` cross-checks the WebAssembly build against a native `wasm2c` when
one is available — put `wat2wasm` and `wasm2c` on `PATH`, or point `WABT_BIN` at
a wabt build directory:

```sh
WABT_BIN=~/wabt/build node scripts/test-core.mjs
```

Every bundled example is diffed line by line against the native tool's output.

## How it fits together

```
native/wasm2c_bindings.cc   C ABI over wabt: WAT -> binary -> IR -> WriteC
       |  emcmake + emcc
src/core/wasm2c.{js,wasm}   the compiled core (committed)
src/core/wasm2c-runner.ts   typed wrapper; strings cross as raw bytes
src/core/worker.ts          runs conversions off the main thread
src/core/client.ts          promise API, drops superseded results
src/App.tsx                 editors, options, diagnostics, sharing
```

The conversion mirrors the `wasm2c` tool exactly: the WAT is assembled to a
binary first, then read back as IR, so the output matches what you would get
from `wat2wasm foo.wat && wasm2c foo.wasm` rather than taking a shortcut
through the text-format IR.

## Licence

The playground is MIT. wabt, vendored under `third_party/`, is Apache-2.0.

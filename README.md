# wasm2c playground

Type WebAssembly in the browser and watch [wabt](https://github.com/WebAssembly/wabt)'s
`wasm2c` turn it into C, live.

Everything runs client-side: wabt itself is compiled to WebAssembly, so there is
no backend, nothing is uploaded, and the site is a pile of static files.

## What it does

- **Live conversion.** The WAT you type is assembled and run through `wasm2c`
  on every edit (debounced, off the main thread). The generated `.c` and `.h`
  appear beside it.
- **Focus on your module.** About 95% of what wasm2c emits is fixed runtime
  scaffolding — an empty module produces 758 of the 787 lines you get for a
  three-line `add`. The playground folds those runs behind labelled
  placeholders (`⋯ 725 lines — wasm2c runtime declarations`), so a small module
  fits on one screen. Line numbers stay real, any block expands on click, and
  Copy and Download always give you the complete file.
- **The runtime, not just the output.** wasm2c writes code against `wasm-rt.h`
  but never emits it, so the generated C names types like
  `wasm_rt_funcref_table_t` that are defined nowhere you can see. wabt's
  runtime sources sit in the same tab strip, and Ctrl/Cmd-clicking an
  identifier jumps to where it is defined — across the generated files and the
  runtime alike. Ctrl/Cmd-clicking an `#include "..."` opens that file.
- **Real diagnostics.** wabt's own error output, carets and all, with the
  offending range underlined in the editor. A broken edit doesn't wipe out the
  C you were reading — it's dimmed and marked stale until the module parses
  again.
- **The actual wasm2c options.** Module name (`-n`), number of output files
  (`--num-outputs`, which adds the shared `-impl.h`), debug names, and the
  feature flags wasm2c accepts.
- **Nothing gets lost.** What you were editing, and the options you set, come
  back after a reload — kept in `localStorage`, never sent anywhere.
- **Shareable links.** The Share button packs the module and options into the
  URL fragment, deflated. A link wins over the saved draft, whether you open it
  in a new tab or paste it into one that is already running.
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

### Looking up a symbol

`src/core/symbols.ts` builds a name-to-location index by scanning for
definitions line by line. It is regex-shaped rather than a C parser on purpose:
the input is wasm2c's own output plus wabt's runtime headers, both consistently
formatted, and a bad guess costs a wasted jump rather than a wrong answer. When
a name matches more than one pattern, a type or macro wins; for a function, the
declaration in a header beats the body in a `.c`, because `wasm-rt.h` is where
the documentation comments live.

The runtime sources under `src/core/runtime/` are vendored from the submodule
by `scripts/build-core.sh`, with their Apache-2.0 headers intact, so the app
still builds without a wabt checkout.

### Finding the scaffolding

wabt keeps its C boilerplate in `src/template/` and pastes each blob into the
output unmodified (`Write(s_source_declarations, ...)`). The bindings export
those exact strings, so `src/core/boilerplate.ts` locates them with a plain
substring match — no parsing, no heuristics, and nothing to keep in sync,
because the templates and the converter come from the same build. Blocks that
wasm2c only emits for some modules, like the SIMD and atomics helpers, are
found the same way when they appear.

## Licence

The playground is MIT. wabt, vendored under `third_party/`, is Apache-2.0.

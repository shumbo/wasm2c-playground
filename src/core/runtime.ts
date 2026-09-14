import wasmRt from './runtime/wasm-rt.h?raw';
import wasmRtImplH from './runtime/wasm-rt-impl.h?raw';
import wasmRtImplC from './runtime/wasm-rt-impl.c?raw';
import wasmRtTableOps from './runtime/wasm-rt-impl-tableops.inc?raw';
import wasmRtMemImpl from './runtime/wasm-rt-mem-impl.c?raw';
import wasmRtMemHelper from './runtime/wasm-rt-mem-impl-helper.inc?raw';
import wasmRtExceptionsH from './runtime/wasm-rt-exceptions.h?raw';
import wasmRtExceptionsC from './runtime/wasm-rt-exceptions-impl.c?raw';

export interface RuntimeFile {
  name: string;
  text: string;
  /** One line on what the file is for, shown in the tab's tooltip. */
  summary: string;
  /** Only surfaced when the module actually uses the feature. */
  requiresFeature?: string;
}

/**
 * wabt's wasm2c runtime, vendored from `wasm2c/` in the submodule.
 *
 * Generated code is written against this interface but never contains it, so
 * without these the C refers to types like `wasm_rt_funcref_table_t` that are
 * defined nowhere you can see. Refresh them with scripts/build-core.sh.
 */
export const RUNTIME_FILES: RuntimeFile[] = [
  {
    name: 'wasm-rt.h',
    text: wasmRt,
    summary:
      'The interface every generated module targets: wasm_rt_* types, traps, memories, tables.',
  },
  {
    name: 'wasm-rt-impl.h',
    text: wasmRtImplH,
    summary: 'Internals of the reference runtime implementation.',
  },
  {
    name: 'wasm-rt-impl.c',
    text: wasmRtImplC,
    summary: 'Reference implementation: traps, tables, function types, instances.',
  },
  {
    name: 'wasm-rt-impl-tableops.inc',
    text: wasmRtTableOps,
    summary: 'Table operations, included twice by wasm-rt-impl.c for funcref and externref.',
  },
  {
    name: 'wasm-rt-mem-impl.c',
    text: wasmRtMemImpl,
    summary: 'Reference implementation of linear memory.',
  },
  {
    name: 'wasm-rt-mem-impl-helper.inc',
    text: wasmRtMemHelper,
    summary: 'Memory helpers, included by wasm-rt-mem-impl.c for 32- and 64-bit memories.',
  },
  {
    name: 'wasm-rt-exceptions.h',
    text: wasmRtExceptionsH,
    summary: 'Exception handling interface.',
    requiresFeature: 'exceptions',
  },
  {
    name: 'wasm-rt-exceptions-impl.c',
    text: wasmRtExceptionsC,
    summary: 'Reference implementation of exception handling.',
    requiresFeature: 'exceptions',
  },
];

/** The runtime files worth showing for a module built with `features`. */
export function runtimeFilesFor(features: string[]): RuntimeFile[] {
  return RUNTIME_FILES.filter(
    (file) => !file.requiresFeature || features.includes(file.requiresFeature),
  );
}

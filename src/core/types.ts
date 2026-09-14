/** Shared vocabulary between the UI and the worker that runs wasm2c. */

export interface Wasm2cOptions {
  /** Prefix for the generated C symbols and for the output filenames. */
  moduleName: string;
  /** wabt feature flags to enable, by their command-line names. */
  features: string[];
  /** Number of .c files to split the module across. */
  numOutputs: number;
  /** Write a names section, so the C identifiers keep the names from the WAT. */
  debugNames: boolean;
}

/** A run of lines in a generated file, 1-based and inclusive at both ends. */
export interface LineRange {
  from: number;
  to: number;
  /** Short human label, e.g. "wasm2c runtime declarations". */
  label: string;
}

export interface OutputFile {
  name: string;
  text: string;
  /**
   * Where wasm2c pasted its fixed scaffolding. Every module gets the same
   * bytes here, so the UI can fold them away and leave the module's own code.
   */
  boilerplate: LineRange[];
}

export interface FeatureInfo {
  flag: string;
  enabledByDefault: boolean;
  /** wasm2c rejects a non-default feature outside its supported subset. */
  canEnable: boolean;
  help: string;
}

export interface ConvertSuccess {
  ok: true;
  files: OutputFile[];
  wasm: Uint8Array;
  durationMs: number;
}

export interface ConvertFailure {
  ok: false;
  /** wabt's formatted diagnostics, caret lines and all. */
  error: string;
  durationMs: number;
}

export type ConvertResult = ConvertSuccess | ConvertFailure;

export const DEFAULT_OPTIONS: Wasm2cOptions = {
  moduleName: 'module',
  // wabt's own defaults, so the playground matches what you get from
  // `wat2wasm foo.wat && wasm2c foo.wasm` with no flags.
  features: [
    'mutable-globals',
    'saturating-float-to-int',
    'sign-extension',
    'simd',
    'multi-value',
    'bulk-memory',
    'reference-types',
  ],
  numOutputs: 1,
  debugNames: true,
};

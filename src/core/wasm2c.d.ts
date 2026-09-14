/** Hand-written types for the Emscripten module built by scripts/build-core.sh. */

export interface Wasm2cWasmModule {
  HEAPU8: Uint8Array;
  _malloc(size: number): number;
  _free(ptr: number): void;

  _w2c_convert(
    input: number,
    inputLen: number,
    isBinary: number,
    moduleName: number,
    featuresCsv: number,
    numOutputs: number,
    debugNames: number,
  ): number;
  _w2c_error(): number;
  _w2c_file_count(): number;
  _w2c_file_name(index: number): number;
  _w2c_file_text(index: number): number;
  _w2c_file_size(index: number): number;
  _w2c_wasm_data(): number;
  _w2c_wasm_size(): number;
  _w2c_all_features(): number;
  _w2c_templates(): number;

  UTF8ToString(ptr: number, maxBytesToRead?: number): string;
}

export interface Wasm2cModuleOptions {
  locateFile?(path: string, prefix: string): string;
}

declare function createWasm2c(
  options?: Wasm2cModuleOptions,
): Promise<Wasm2cWasmModule>;

export default createWasm2c;

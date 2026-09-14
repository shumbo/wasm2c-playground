import createWasm2c from './wasm2c.js';
import type { Wasm2cWasmModule } from './wasm2c.js';
import wasmBinaryUrl from './wasm2c.wasm?url';
import { findBoilerplate, parseTemplates, type TemplateBlock } from './boilerplate';
import type {
  ConvertResult,
  FeatureInfo,
  OutputFile,
  Wasm2cOptions,
} from './types';

const decoder = new TextDecoder();
const encoder = new TextEncoder();

/**
 * Thin wrapper over the Emscripten module. Strings cross the boundary as raw
 * bytes rather than through UTF8ToString so that generated C containing NUL
 * bytes (possible via a module's names section) survives the trip intact.
 */
export class Wasm2cRunner {
  private constructor(
    private readonly mod: Wasm2cWasmModule,
    /** wasm2c's fixed scaffolding; read once, it never changes. */
    private readonly templates: TemplateBlock[],
  ) {}

  static async load(): Promise<Wasm2cRunner> {
    const mod = await createWasm2c({
      // Vite fingerprints the .wasm, so the default sibling lookup would miss.
      locateFile: (path) => (path.endsWith('.wasm') ? wasmBinaryUrl : path),
    });
    const runner = new Wasm2cRunner(mod, []);
    return new Wasm2cRunner(
      mod,
      parseTemplates(runner.readCString(mod._w2c_templates())),
    );
  }

  /** Every feature wabt knows about, straight from its feature.def. */
  features(): FeatureInfo[] {
    const raw = this.readCString(this.mod._w2c_all_features());
    return raw
      .split('\n')
      .filter((line) => line.length > 0)
      .map((line) => {
        const [flag, dflt, supported, ...rest] = line.split(',');
        return {
          flag,
          enabledByDefault: dflt === '1',
          canEnable: supported === '1',
          help: rest.join(','),
        };
      });
  }

  convert(input: string | Uint8Array, options: Wasm2cOptions): ConvertResult {
    const started = performance.now();
    const isBinary = typeof input !== 'string';
    const inputBytes = isBinary ? input : encoder.encode(input);

    const pointers: number[] = [];
    const alloc = (bytes: Uint8Array): number => {
      // malloc(0) is allowed to return null, which would look like a failure.
      const ptr = this.mod._malloc(Math.max(bytes.length, 1));
      pointers.push(ptr);
      this.mod.HEAPU8.set(bytes, ptr);
      return ptr;
    };
    const allocString = (value: string): number => {
      const bytes = encoder.encode(value);
      const ptr = this.mod._malloc(bytes.length + 1);
      pointers.push(ptr);
      this.mod.HEAPU8.set(bytes, ptr);
      this.mod.HEAPU8[ptr + bytes.length] = 0;
      return ptr;
    };

    try {
      const inputPtr = alloc(inputBytes);
      const namePtr = allocString(options.moduleName);
      const featuresPtr = allocString(options.features.join(','));

      const ok = this.mod._w2c_convert(
        inputPtr,
        inputBytes.length,
        isBinary ? 1 : 0,
        namePtr,
        featuresPtr,
        options.numOutputs,
        options.debugNames ? 1 : 0,
      );
      const durationMs = performance.now() - started;

      if (!ok) {
        return {
          ok: false,
          error: this.readCString(this.mod._w2c_error()),
          durationMs,
        };
      }

      const files: OutputFile[] = [];
      const count = this.mod._w2c_file_count();
      for (let i = 0; i < count; i++) {
        const text = this.readBytes(
          this.mod._w2c_file_text(i),
          this.mod._w2c_file_size(i),
        );
        files.push({
          name: this.readCString(this.mod._w2c_file_name(i)),
          text,
          boilerplate: findBoilerplate(text, this.templates),
        });
      }

      const wasmPtr = this.mod._w2c_wasm_data();
      const wasmSize = this.mod._w2c_wasm_size();
      // Copy out of the heap: it can move under us on the next allocation.
      const wasm = this.mod.HEAPU8.slice(wasmPtr, wasmPtr + wasmSize);

      return { ok: true, files, wasm, durationMs };
    } finally {
      for (const ptr of pointers) {
        this.mod._free(ptr);
      }
    }
  }

  private readBytes(ptr: number, length: number): string {
    return decoder.decode(this.mod.HEAPU8.subarray(ptr, ptr + length));
  }

  private readCString(ptr: number): string {
    const heap = this.mod.HEAPU8;
    let end = ptr;
    while (heap[end] !== 0) {
      end++;
    }
    return decoder.decode(heap.subarray(ptr, end));
  }
}

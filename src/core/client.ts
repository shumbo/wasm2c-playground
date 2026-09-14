import type { ConvertResult, FeatureInfo, Wasm2cOptions } from './types';
import type { WorkerRequest, WorkerResponse } from './worker';

/**
 * Drives the wasm2c worker. Conversions run off the main thread so that a
 * large module can't freeze typing, and only the newest request's result is
 * delivered — earlier ones are dropped rather than racing to render.
 */
export class Wasm2cClient {
  private readonly worker: Worker;
  private nextId = 1;
  private readonly pending = new Map<
    number,
    { resolve(value: never): void; reject(error: Error): void }
  >();

  constructor() {
    this.worker = new Worker(new URL('./worker.ts', import.meta.url), {
      type: 'module',
    });
    this.worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const message = event.data;
      const entry = this.pending.get(message.id);
      if (!entry) {
        return;
      }
      this.pending.delete(message.id);
      if (message.kind === 'error') {
        entry.reject(new Error(message.message));
      } else if (message.kind === 'init') {
        entry.resolve(message.features as never);
      } else {
        entry.resolve(message.result as never);
      }
    };
    this.worker.onerror = (event) => {
      const error = new Error(event.message || 'wasm2c worker failed to start');
      for (const entry of this.pending.values()) {
        entry.reject(error);
      }
      this.pending.clear();
    };
  }

  init(): Promise<FeatureInfo[]> {
    return this.send({ id: this.nextId++, kind: 'init' });
  }

  convert(
    input: string | Uint8Array,
    options: Wasm2cOptions,
  ): Promise<ConvertResult> {
    return this.send({
      id: this.nextId++,
      kind: 'convert',
      input,
      options,
    });
  }

  dispose(): void {
    this.worker.terminate();
    this.pending.clear();
  }

  private send<T>(request: WorkerRequest): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.pending.set(request.id, {
        resolve: resolve as (value: never) => void,
        reject,
      });
      this.worker.postMessage(request);
    });
  }
}

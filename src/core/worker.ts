/// <reference lib="webworker" />
import { Wasm2cRunner } from './wasm2c-runner';
import type { ConvertResult, FeatureInfo, Wasm2cOptions } from './types';

export type WorkerRequest =
  | { id: number; kind: 'init' }
  | {
      id: number;
      kind: 'convert';
      input: string | Uint8Array;
      options: Wasm2cOptions;
    };

export type WorkerResponse =
  | { id: number; kind: 'init'; features: FeatureInfo[] }
  | { id: number; kind: 'convert'; result: ConvertResult }
  | { id: number; kind: 'error'; message: string };

let runner: Promise<Wasm2cRunner> | null = null;

function ensureRunner(): Promise<Wasm2cRunner> {
  runner ??= Wasm2cRunner.load();
  return runner;
}

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;
  try {
    const instance = await ensureRunner();
    if (request.kind === 'init') {
      const response: WorkerResponse = {
        id: request.id,
        kind: 'init',
        features: instance.features(),
      };
      self.postMessage(response);
      return;
    }

    const result = instance.convert(request.input, request.options);
    const response: WorkerResponse = {
      id: request.id,
      kind: 'convert',
      result,
    };
    self.postMessage(response);
  } catch (error) {
    // A failure here is a crash in the wasm module rather than a bad module,
    // so surface it distinctly from wabt's own diagnostics.
    const response: WorkerResponse = {
      id: request.id,
      kind: 'error',
      message: error instanceof Error ? error.message : String(error),
    };
    self.postMessage(response);
  }
};

import { DEFAULT_OPTIONS, normalizeOptions, type Wasm2cOptions } from '../core/types';

export interface SharedState {
  wat: string;
  options: Wasm2cOptions;
}

interface Payload {
  v: 1;
  wat: string;
  name?: string;
  features?: string[];
  outputs?: number;
  debugNames?: boolean;
}

const PREFIX_DEFLATE = 'z';
const PREFIX_PLAIN = 'p';

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(value: string): Uint8Array<ArrayBuffer> {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function squeeze(
  bytes: Uint8Array<ArrayBuffer>,
  format: 'deflate-raw',
): Promise<Uint8Array<ArrayBuffer>> {
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream(format));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function expand(
  bytes: Uint8Array<ArrayBuffer>,
  format: 'deflate-raw',
): Promise<Uint8Array<ArrayBuffer>> {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream(format));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * Packs the editor state into a URL fragment. Deflate keeps typical modules
 * comfortably inside what browsers and chat clients will carry; if the browser
 * lacks CompressionStream we fall back to plain base64 rather than dropping
 * the feature.
 */
export async function encodeState(state: SharedState): Promise<string> {
  const payload: Payload = { v: 1, wat: state.wat };
  if (state.options.moduleName !== DEFAULT_OPTIONS.moduleName) {
    payload.name = state.options.moduleName;
  }
  if (!sameFeatures(state.options.features, DEFAULT_OPTIONS.features)) {
    payload.features = state.options.features;
  }
  if (state.options.numOutputs !== DEFAULT_OPTIONS.numOutputs) {
    payload.outputs = state.options.numOutputs;
  }
  if (state.options.debugNames !== DEFAULT_OPTIONS.debugNames) {
    payload.debugNames = state.options.debugNames;
  }

  const json = new TextEncoder().encode(JSON.stringify(payload));
  if (typeof CompressionStream === 'function') {
    try {
      return PREFIX_DEFLATE + toBase64Url(await squeeze(json, 'deflate-raw'));
    } catch {
      // fall through to the uncompressed form
    }
  }
  return PREFIX_PLAIN + toBase64Url(json);
}

export async function decodeState(fragment: string): Promise<SharedState | null> {
  if (fragment.length < 2) {
    return null;
  }
  try {
    const body = fromBase64Url(fragment.slice(1));
    const json =
      fragment[0] === PREFIX_DEFLATE ? await expand(body, 'deflate-raw') : body;
    const payload = JSON.parse(new TextDecoder().decode(json)) as Payload;
    if (typeof payload?.wat !== 'string') {
      return null;
    }
    return {
      wat: payload.wat,
      options: normalizeOptions({
        moduleName: payload.name,
        features: payload.features,
        numOutputs: payload.outputs,
        debugNames: payload.debugNames,
      }),
    };
  } catch {
    return null;
  }
}

function sameFeatures(a: string[], b: string[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  const sortedA = [...a].sort();
  const sortedB = [...b].sort();
  return sortedA.every((value, index) => value === sortedB[index]);
}

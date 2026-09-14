import { normalizeOptions, type Wasm2cOptions } from '../core/types';

const KEY = 'wasm2c-playground:draft';
const VERSION = 1;

/**
 * Browsers give a origin a few megabytes in total. A module past this is far
 * outside what anyone types into a playground, and silently failing every
 * keystroke is worse than not saving it.
 */
const MAX_CHARS = 512 * 1024;

export interface Draft {
  wat: string;
  options: Wasm2cOptions;
}

/** The module being edited, from the last session in this browser. */
export function loadDraft(): Draft | null {
  let stored: string | null = null;
  try {
    stored = localStorage.getItem(KEY);
  } catch {
    // Private browsing or blocked site data.
    return null;
  }
  if (!stored) {
    return null;
  }

  try {
    const payload = JSON.parse(stored) as { v?: unknown; wat?: unknown; options?: unknown };
    if (payload?.v !== VERSION || typeof payload.wat !== 'string') {
      return null;
    }
    return { wat: payload.wat, options: normalizeOptions(payload.options) };
  } catch {
    // Corrupt or written by an older version; start fresh.
    return null;
  }
}

export function saveDraft(draft: Draft): void {
  if (draft.wat.length > MAX_CHARS) {
    return;
  }
  try {
    localStorage.setItem(
      KEY,
      JSON.stringify({ v: VERSION, wat: draft.wat, options: draft.options }),
    );
  } catch {
    // Out of quota, or storage is unavailable; the draft just won't persist.
  }
}

export function clearDraft(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}

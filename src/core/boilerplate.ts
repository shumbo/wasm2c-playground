import type { LineRange } from './types';

export interface TemplateBlock {
  name: string;
  text: string;
}

/** Folding two lines away helps nobody; it just adds a placeholder to read. */
const MIN_FOLD_LINES = 4;

const LABELS: Record<string, string> = {
  'source-includes': 'standard C includes',
  'source-declarations': 'wasm2c runtime declarations',
  'simd-declarations': 'SIMD helpers',
  'atomics-declarations': 'atomics helpers',
  'header-top': 'wasm-rt types',
  'header-bottom': 'C++ linkage guard',
};

/**
 * Parses the `name\n<byte length>\n<text>` records that w2c_templates() emits.
 * The length is explicit because every block contains newlines.
 */
export function parseTemplates(raw: string): TemplateBlock[] {
  const blocks: TemplateBlock[] = [];
  let cursor = 0;
  while (cursor < raw.length) {
    const nameEnd = raw.indexOf('\n', cursor);
    if (nameEnd < 0) {
      break;
    }
    const lengthEnd = raw.indexOf('\n', nameEnd + 1);
    if (lengthEnd < 0) {
      break;
    }
    const name = raw.slice(cursor, nameEnd);
    const length = Number(raw.slice(nameEnd + 1, lengthEnd));
    if (!Number.isInteger(length) || length < 0) {
      break;
    }
    const start = lengthEnd + 1;
    blocks.push({ name, text: raw.slice(start, start + length) });
    cursor = start + length;
  }
  return blocks;
}

/**
 * Finds the scaffolding wasm2c pasted into `text`.
 *
 * wabt writes each template blob unmodified, so an exact substring match is
 * enough — no parsing or heuristics, and it stays correct if the templates
 * change, because they come from the same build as the converter.
 */
export function findBoilerplate(text: string, templates: TemplateBlock[]): LineRange[] {
  const lineStarts = indexLines(text);
  const ranges: LineRange[] = [];

  for (const template of templates) {
    if (template.text.length === 0) {
      continue;
    }
    const label = LABELS[template.name] ?? template.name;
    let from = text.indexOf(template.text);
    while (from !== -1) {
      const firstLine = lineNumberAt(lineStarts, from);
      const lastLine = lineNumberAt(lineStarts, from + template.text.length - 1);
      if (lastLine - firstLine + 1 >= MIN_FOLD_LINES) {
        ranges.push({ from: firstLine, to: lastLine, label });
      }
      from = text.indexOf(template.text, from + template.text.length);
    }
  }

  return ranges.sort((a, b) => a.from - b.from);
}

export function countBoilerplateLines(ranges: LineRange[]): number {
  return ranges.reduce((total, range) => total + (range.to - range.from + 1), 0);
}

function indexLines(text: string): number[] {
  const starts = [0];
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10) {
      starts.push(i + 1);
    }
  }
  return starts;
}

/** Binary search for the 1-based line containing `offset`. */
function lineNumberAt(lineStarts: number[], offset: number): number {
  let low = 0;
  let high = lineStarts.length - 1;
  while (low < high) {
    const mid = (low + high + 1) >> 1;
    if (lineStarts[mid] <= offset) {
      low = mid;
    } else {
      high = mid - 1;
    }
  }
  return low + 1;
}

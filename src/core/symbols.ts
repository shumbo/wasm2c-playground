/** Where a symbol is defined, for jumping to it from a use. */
export interface SymbolLocation {
  file: string;
  /** 1-based. */
  line: number;
}

interface Candidate extends SymbolLocation {
  /** Higher wins when a name is matched by more than one pattern. */
  rank: number;
}

export interface SourceFile {
  name: string;
  text: string;
}

/**
 * Ranks, highest first. A type or macro is always the answer for a type or
 * macro. For a function, the declaration in a header beats the body in a .c:
 * wasm-rt.h carries the documentation comments, which is what someone reading
 * generated C is actually after.
 */
const RANK_TYPE = 3;
const RANK_HEADER_DECL = 2;
const RANK_DEFINITION = 1;

// `} wasm_rt_funcref_table_t;` — closes a typedef'd struct, enum, or union.
const TYPEDEF_CLOSE = /^\s*\}\s*([A-Za-z_]\w*)\s*;/;
// `typedef uint32_t wasm_rt_tag_t;`
const TYPEDEF_SIMPLE = /^\s*typedef\s+[^;()]+?\b([A-Za-z_]\w*)\s*(?:\[[^\]]*\])?\s*;/;
// `typedef void (*wasm_rt_funcref_t)(void);`
const TYPEDEF_FUNCPTR = /^\s*typedef\s+.*\(\s*\*\s*([A-Za-z_]\w*)\s*\)\s*\(/;
// `typedef struct w2c_module {` / `struct wasm_rt_memory {`
const TAGGED_OPEN = /^\s*(?:typedef\s+)?(?:struct|enum|union)\s+([A-Za-z_]\w*)\s*\{/;
// `#define WASM_RT_FUNCREF ...`
const MACRO = /^\s*#\s*define\s+([A-Za-z_]\w*)/;
/*
 * A function at top level: return type, then the name, then `(`. Anchored at
 * the start of the line so calls and nested expressions can't match, and the
 * leading part must look like a type rather than a control keyword.
 */
const FUNCTION = /^(?:[A-Za-z_]\w*[\w\s\*]*?\s|\s*)\**([A-Za-z_]\w*)\s*\(/;
const NOT_A_TYPE = /^\s*(?:if|for|while|switch|return|else|do|case|sizeof|defined)\b/;

/**
 * Builds a name -> location index by scanning for definitions line by line.
 *
 * This is deliberately regex-shaped rather than a C parser: the input is
 * wasm2c's own output plus wabt's runtime headers, both of which are
 * consistently formatted, and a wrong guess costs a wasted jump rather than a
 * wrong result.
 */
export function buildSymbolIndex(files: SourceFile[]): Map<string, SymbolLocation> {
  const best = new Map<string, Candidate>();

  const offer = (name: string, file: string, line: number, rank: number) => {
    if (name.length < 2) {
      return;
    }
    const current = best.get(name);
    if (!current || rank > current.rank) {
      best.set(name, { file, line, rank });
    }
  };

  for (const file of files) {
    const isHeader = /\.(h|inc)$/.test(file.name);
    const lines = file.text.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lineNumber = i + 1;

      const typed =
        TYPEDEF_CLOSE.exec(line) ??
        TYPEDEF_FUNCPTR.exec(line) ??
        TYPEDEF_SIMPLE.exec(line) ??
        TAGGED_OPEN.exec(line) ??
        MACRO.exec(line);
      if (typed) {
        offer(typed[1], file.name, lineNumber, RANK_TYPE);
        continue;
      }

      // Only consider a function where the line starts at column 0; wasm2c and
      // the runtime both put top-level declarations there, and indented lines
      // are statements.
      if (line.length === 0 || /^\s/.test(line) || NOT_A_TYPE.test(line)) {
        continue;
      }
      const fn = FUNCTION.exec(line);
      if (fn) {
        const declaration = line.trimEnd().endsWith(';');
        offer(
          fn[1],
          file.name,
          lineNumber,
          declaration && isHeader ? RANK_HEADER_DECL : RANK_DEFINITION,
        );
      }
    }
  }

  const index = new Map<string, SymbolLocation>();
  for (const [name, candidate] of best) {
    index.set(name, { file: candidate.file, line: candidate.line });
  }
  return index;
}

/** The identifier under `offset`, or null if that spot isn't one. */
export function wordAt(text: string, offset: number): string | null {
  const isWordChar = (index: number) =>
    index >= 0 && index < text.length && /[A-Za-z0-9_]/.test(text[index]);
  if (!isWordChar(offset) && !isWordChar(offset - 1)) {
    return null;
  }
  let start = offset;
  while (isWordChar(start - 1)) {
    start--;
  }
  let end = offset;
  while (isWordChar(end)) {
    end++;
  }
  const word = text.slice(start, end);
  return /^[A-Za-z_]/.test(word) ? word : null;
}

/** The file named by an `#include "..."` line, if that's what this line is. */
export function includeTarget(line: string): string | null {
  const match = /^\s*#\s*include\s+"([^"]+)"/.exec(line);
  return match ? match[1] : null;
}

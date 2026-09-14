import type { Diagnostic } from '@codemirror/lint';
import type { Text } from '@codemirror/state';

const MESSAGE = /^input\.wat:(\d+):(\d+):\s+(error|warning):\s+(.*)$/;
const CARETS = /^(\s*)(\^+)\s*$/;

/**
 * Turns wabt's formatted diagnostics into CodeMirror ranges.
 *
 * wabt prints each problem as a `file:line:col: error: message` line followed
 * by the offending source line and a row of carets. The carets are what give
 * us a width to underline, so we read them when they're there and fall back to
 * a single character when they're not.
 */
export function parseDiagnostics(formatted: string, doc: Text): Diagnostic[] {
  const lines = formatted.split('\n');
  const diagnostics: Diagnostic[] = [];

  for (let i = 0; i < lines.length; i++) {
    const match = MESSAGE.exec(lines[i]);
    if (!match) {
      continue;
    }

    const lineNumber = Number(match[1]);
    const column = Number(match[2]);
    const severity = match[3] === 'warning' ? 'warning' : 'error';
    const message = match[4];

    if (lineNumber < 1 || lineNumber > doc.lines) {
      continue;
    }
    const line = doc.line(lineNumber);
    const from = Math.min(line.from + Math.max(column - 1, 0), line.to);

    // wabt emits the source line then the carets; the caret run tells us how
    // much of the line the problem covers.
    const caretMatch = CARETS.exec(lines[i + 2] ?? '');
    const width = caretMatch ? caretMatch[2].length : 1;
    const to = Math.min(from + width, line.to);

    diagnostics.push({
      from,
      to: to > from ? to : Math.min(from + 1, doc.length),
      severity,
      message,
    });
  }

  return diagnostics;
}

/** The first `error:` message, for the one-line summary in the status bar. */
export function firstErrorMessage(formatted: string): string {
  for (const line of formatted.split('\n')) {
    const match = MESSAGE.exec(line);
    if (match) {
      return match[4];
    }
  }
  return formatted.split('\n').find((line) => line.trim().length > 0) ?? 'conversion failed';
}

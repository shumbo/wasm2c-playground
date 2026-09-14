import { useEffect, useMemo, useRef } from 'react';
import { defaultKeymap } from '@codemirror/commands';
import {
  bracketMatching,
  codeFolding,
  foldEffect,
  foldGutter,
  foldKeymap,
  unfoldAll,
} from '@codemirror/language';
import { cpp } from '@codemirror/lang-cpp';
import { highlightSelectionMatches, search, searchKeymap } from '@codemirror/search';
import { EditorState, StateEffect, StateField } from '@codemirror/state';
import { drawSelection, EditorView, keymap, lineNumbers } from '@codemirror/view';
import type { LineRange } from '../core/types';
import { editorTheme, highlighting } from '../lib/editor-theme';

interface CodeViewerProps {
  value: string;
  /** Runs of scaffolding that "focus" collapses. */
  boilerplate: LineRange[];
  focus: boolean;
  /** Keeps the scroll position per output file rather than per viewer. */
  resetKey: string;
}

/**
 * The ranges live in editor state so the fold placeholder can name the block
 * it replaced; a fold effect on its own only carries positions.
 */
const setBoilerplate = StateEffect.define<LineRange[]>();

const boilerplateField = StateField.define<LineRange[]>({
  create: () => [],
  update(value, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(setBoilerplate)) {
        return effect.value;
      }
    }
    return value;
  },
});

interface Placeholder {
  label: string;
  lines: number;
}

const folding = codeFolding({
  preparePlaceholder(state, range): Placeholder {
    const first = state.doc.lineAt(range.from).number;
    const last = state.doc.lineAt(range.to).number;
    const match = state.field(boilerplateField, false)?.find((r) => r.from === first);
    return { label: match?.label ?? 'folded', lines: last - first + 1 };
  },
  placeholderDOM(_view, onclick, prepared: Placeholder) {
    const element = document.createElement('span');
    element.className = 'fold-placeholder';
    element.title = 'Click to expand';
    element.setAttribute('role', 'button');
    element.setAttribute('tabindex', '0');
    element.textContent = `${prepared.lines} lines — ${prepared.label}`;
    element.onclick = onclick;
    element.onkeydown = (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        onclick(event);
      }
    };
    return element;
  },
});

export function CodeViewer({ value, boilerplate, focus, resetKey }: CodeViewerProps) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);

  useEffect(() => {
    if (!host.current) {
      return;
    }
    const instance = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: value,
        extensions: [
          lineNumbers(),
          foldGutter(),
          folding,
          boilerplateField,
          drawSelection(),
          bracketMatching(),
          highlightSelectionMatches(),
          search({ top: true }),
          cpp(),
          editorTheme,
          highlighting,
          EditorState.readOnly.of(true),
          EditorView.editable.of(false),
          keymap.of([...defaultKeymap, ...searchKeymap, ...foldKeymap]),
        ],
      }),
    });
    view.current = instance;
    return () => {
      instance.destroy();
      view.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Fold state is positional, so the document and the folds have to be
  // replaced together or the placeholders land on the wrong lines.
  const signature = useMemo(
    () => boilerplate.map((r) => `${r.from}-${r.to}`).join(),
    [boilerplate],
  );

  useEffect(() => {
    const instance = view.current;
    if (!instance) {
      return;
    }

    const changed = instance.state.doc.toString() !== value;
    if (changed) {
      instance.dispatch({
        changes: { from: 0, to: instance.state.doc.length, insert: value },
        effects: setBoilerplate.of(boilerplate),
      });
    } else {
      instance.dispatch({ effects: setBoilerplate.of(boilerplate) });
    }

    unfoldAll(instance);
    if (!focus) {
      return;
    }
    const doc = instance.state.doc;
    const effects = boilerplate
      .filter((range) => range.from >= 1 && range.to <= doc.lines)
      .map((range) =>
        foldEffect.of({
          from: doc.line(range.from).from,
          to: doc.line(range.to).to,
        }),
      );
    if (effects.length > 0) {
      instance.dispatch({ effects });
    }
  }, [value, focus, signature, boilerplate]);

  useEffect(() => {
    view.current?.scrollDOM.scrollTo({ top: 0 });
  }, [resetKey]);

  return <div className="editor" ref={host} />;
}

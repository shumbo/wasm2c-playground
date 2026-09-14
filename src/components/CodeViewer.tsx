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
import {
  Decoration,
  type DecorationSet,
  drawSelection,
  EditorView,
  keymap,
  lineNumbers,
} from '@codemirror/view';
import type { LineRange } from '../core/types';
import { includeTarget, wordAt } from '../core/symbols';
import { editorTheme, highlighting } from '../lib/editor-theme';

export interface FollowRequest {
  kind: 'symbol' | 'include';
  value: string;
}

/** A line to reveal, with a nonce so the same line can be revisited. */
export interface JumpTarget {
  line: number;
  nonce: number;
}

interface CodeViewerProps {
  value: string;
  /** Runs of scaffolding that "focus" collapses. */
  boilerplate: LineRange[];
  focus: boolean;
  /** Keeps the scroll position per output file rather than per viewer. */
  resetKey: string;
  jumpTo?: JumpTarget | null;
  /** Ctrl/Cmd-click on an identifier or an #include path. */
  onFollow?(request: FollowRequest): void;
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

/**
 * Marks the line a jump landed on. This has to be editor state rather than a
 * class on the DOM node: scrolling re-renders the lines around the target and
 * would throw a manually added class away.
 */
const setFlash = StateEffect.define<number | null>();
const flashDecoration = Decoration.line({ class: 'cm-jumpFlash' });

const flashField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, transaction) {
    if (transaction.docChanged) {
      return Decoration.none;
    }
    for (const effect of transaction.effects) {
      if (effect.is(setFlash)) {
        return effect.value == null
          ? Decoration.none
          : Decoration.set([flashDecoration.range(effect.value)]);
      }
    }
    return value;
  },
  provide: (field) => EditorView.decorations.from(field),
});

const FLASH_MS = 1200;

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

export function CodeViewer({
  value,
  boilerplate,
  focus,
  resetKey,
  jumpTo,
  onFollow,
}: CodeViewerProps) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  // Held in a ref so a changing callback never tears down the editor.
  const onFollowRef = useRef(onFollow);
  onFollowRef.current = onFollow;

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
          flashField,
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
          EditorView.domEventHandlers({
            mousedown(event, editor) {
              if (!(event.metaKey || event.ctrlKey) || event.button !== 0) {
                return false;
              }
              const pos = editor.posAtCoords({ x: event.clientX, y: event.clientY });
              if (pos == null) {
                return false;
              }
              // An #include path wins over the word under the pointer, so
              // clicking anywhere on the line follows the include.
              const line = editor.state.doc.lineAt(pos);
              const include = includeTarget(line.text);
              if (include) {
                event.preventDefault();
                onFollowRef.current?.({ kind: 'include', value: include });
                return true;
              }
              const word = wordAt(editor.state.doc.toString(), pos);
              if (word) {
                event.preventDefault();
                onFollowRef.current?.({ kind: 'symbol', value: word });
                return true;
              }
              return false;
            },
          }),
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

  // Reveal a jump target. Runs after the document effect above, so the line
  // numbers belong to the file that is actually on screen.
  useEffect(() => {
    const instance = view.current;
    if (!instance || !jumpTo) {
      return;
    }
    const doc = instance.state.doc;
    const line = doc.line(Math.min(Math.max(jumpTo.line, 1), doc.lines));
    instance.dispatch({
      selection: { anchor: line.from },
      effects: [
        EditorView.scrollIntoView(line.from, { y: 'center' }),
        // A selection alone is easy to lose track of after the view scrolls.
        setFlash.of(line.from),
      ],
    });
    const timer = setTimeout(() => {
      view.current?.dispatch({ effects: setFlash.of(null) });
    }, FLASH_MS);
    return () => clearTimeout(timer);
  }, [jumpTo]);

  return <div className="editor" ref={host} />;
}

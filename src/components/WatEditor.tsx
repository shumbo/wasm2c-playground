import { useEffect, useMemo, useRef } from 'react';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import {
  bracketMatching,
  foldGutter,
  foldKeymap,
  indentOnInput,
  StreamLanguage,
} from '@codemirror/language';
import { wast } from '@codemirror/legacy-modes/mode/wast';
import { type Diagnostic, lintGutter, setDiagnostics } from '@codemirror/lint';
import { highlightSelectionMatches, search, searchKeymap } from '@codemirror/search';
import { Compartment, EditorState } from '@codemirror/state';
import {
  drawSelection,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
  rectangularSelection,
} from '@codemirror/view';
import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete';
import { editorTheme, highlighting } from '../lib/editor-theme';

interface WatEditorProps {
  value: string;
  diagnostics: Diagnostic[];
  onChange(value: string): void;
}

export function WatEditor({ value, diagnostics, onChange }: WatEditorProps) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  // Held in a ref so the editor is created once and never torn down by a
  // changing callback identity.
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const editable = useMemo(() => new Compartment(), []);

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
          highlightActiveLineGutter(),
          highlightActiveLine(),
          foldGutter(),
          lintGutter(),
          history(),
          drawSelection(),
          rectangularSelection(),
          indentOnInput(),
          bracketMatching(),
          closeBrackets(),
          highlightSelectionMatches(),
          search({ top: true }),
          StreamLanguage.define(wast),
          editorTheme,
          highlighting,
          EditorView.lineWrapping,
          // Keep writing assistants out of the code editor: they inject their
          // own DOM into the contenteditable, which fights CodeMirror's view
          // and puts squiggles under every WAT keyword. CodeMirror already
          // sets spellcheck="false"; these are Grammarly's own opt-outs, old
          // and new attribute names both.
          EditorView.contentAttributes.of({
            'data-gramm': 'false',
            'data-gramm_editor': 'false',
            'data-enable-grammarly': 'false',
          }),
          editable.of(EditorView.editable.of(true)),
          keymap.of([
            ...closeBracketsKeymap,
            ...defaultKeymap,
            ...searchKeymap,
            ...historyKeymap,
            ...foldKeymap,
            indentWithTab,
          ]),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              onChangeRef.current(update.state.doc.toString());
            }
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

  // Replace the document only when the change came from outside the editor
  // (an example, a shared link), so typing isn't interrupted.
  useEffect(() => {
    const instance = view.current;
    if (!instance || instance.state.doc.toString() === value) {
      return;
    }
    instance.dispatch({
      changes: { from: 0, to: instance.state.doc.length, insert: value },
    });
  }, [value]);

  useEffect(() => {
    const instance = view.current;
    if (instance) {
      instance.dispatch(setDiagnostics(instance.state, diagnostics));
    }
  }, [diagnostics]);

  return <div className="editor" ref={host} />;
}

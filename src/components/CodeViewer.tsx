import { useEffect, useRef } from 'react';
import { defaultKeymap } from '@codemirror/commands';
import { bracketMatching, foldGutter, foldKeymap } from '@codemirror/language';
import { cpp } from '@codemirror/lang-cpp';
import { highlightSelectionMatches, search, searchKeymap } from '@codemirror/search';
import { EditorState } from '@codemirror/state';
import {
  drawSelection,
  EditorView,
  keymap,
  lineNumbers,
} from '@codemirror/view';
import { editorTheme, highlighting } from '../lib/editor-theme';

interface CodeViewerProps {
  value: string;
  /** Keeps the scroll position per output file rather than per viewer. */
  resetKey: string;
}

export function CodeViewer({ value, resetKey }: CodeViewerProps) {
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

  useEffect(() => {
    const instance = view.current;
    if (!instance || instance.state.doc.toString() === value) {
      return;
    }
    instance.dispatch({
      changes: { from: 0, to: instance.state.doc.length, insert: value },
      // Jump back to the top when switching files; stay put on a re-convert.
      scrollIntoView: false,
    });
  }, [value]);

  useEffect(() => {
    view.current?.scrollDOM.scrollTo({ top: 0 });
  }, [resetKey]);

  return <div className="editor" ref={host} />;
}

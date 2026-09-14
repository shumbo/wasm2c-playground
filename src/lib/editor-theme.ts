import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { EditorView } from '@codemirror/view';
import { tags } from '@lezer/highlight';

/**
 * One theme for both colour schemes: every colour is a CSS variable, so
 * flipping `data-theme` on the document restyles the editors without
 * reconfiguring them.
 */
export const editorTheme = EditorView.theme({
  '&': {
    height: '100%',
    fontSize: 'var(--code-size)',
    backgroundColor: 'var(--surface)',
    color: 'var(--text)',
  },
  '.cm-scroller': {
    fontFamily: 'var(--mono)',
    lineHeight: '1.6',
    overflow: 'auto',
  },
  '.cm-content': {
    padding: '12px 0 40vh',
    caretColor: 'var(--accent)',
  },
  '.cm-gutters': {
    backgroundColor: 'var(--surface)',
    color: 'var(--text-faint)',
    border: 'none',
    paddingRight: '4px',
  },
  '.cm-lineNumbers .cm-gutterElement': {
    padding: '0 8px 0 16px',
    minWidth: '44px',
  },
  '.cm-activeLine': { backgroundColor: 'var(--line-active)' },
  '.cm-activeLineGutter': {
    backgroundColor: 'var(--line-active)',
    color: 'var(--text-muted)',
  },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--accent)' },
  '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection':
    { backgroundColor: 'var(--selection)' },
  '.cm-selectionMatch': { backgroundColor: 'var(--selection-match)' },
  '.cm-matchingBracket, &.cm-focused .cm-matchingBracket': {
    backgroundColor: 'var(--bracket-match)',
    outline: '1px solid var(--border-strong)',
  },
  '.cm-searchMatch': { backgroundColor: 'var(--selection-match)' },
  '.cm-searchMatch.cm-searchMatch-selected': {
    backgroundColor: 'var(--selection)',
  },
  '.cm-panels': {
    backgroundColor: 'var(--surface-raised)',
    color: 'var(--text)',
    borderTop: '1px solid var(--border)',
  },
  '.cm-panel input, .cm-panel button': {
    fontFamily: 'inherit',
    fontSize: '12px',
  },
  '.cm-tooltip': {
    backgroundColor: 'var(--surface-raised)',
    border: '1px solid var(--border)',
    borderRadius: '6px',
    color: 'var(--text)',
  },
  '.cm-lintRange-error': {
    backgroundImage: 'none',
    textDecoration: 'underline wavy var(--danger)',
    textUnderlineOffset: '3px',
  },
  '.cm-lintRange-warning': {
    backgroundImage: 'none',
    textDecoration: 'underline wavy var(--warning)',
    textUnderlineOffset: '3px',
  },
  '.cm-lint-marker-error': { content: 'none' },
  '.cm-foldPlaceholder': {
    backgroundColor: 'var(--surface-sunken)',
    border: '1px solid var(--border)',
    color: 'var(--text-muted)',
  },
});

export const highlighting = syntaxHighlighting(
  HighlightStyle.define([
    { tag: tags.keyword, color: 'var(--syn-keyword)' },
    { tag: tags.controlKeyword, color: 'var(--syn-keyword)', fontWeight: '600' },
    { tag: tags.operatorKeyword, color: 'var(--syn-keyword)' },
    { tag: tags.definitionKeyword, color: 'var(--syn-keyword)' },
    { tag: tags.modifier, color: 'var(--syn-keyword)' },
    { tag: tags.atom, color: 'var(--syn-atom)' },
    { tag: tags.bool, color: 'var(--syn-atom)' },
    { tag: tags.number, color: 'var(--syn-number)' },
    { tag: tags.string, color: 'var(--syn-string)' },
    { tag: tags.special(tags.string), color: 'var(--syn-string)' },
    { tag: tags.escape, color: 'var(--syn-escape)' },
    { tag: tags.character, color: 'var(--syn-string)' },
    { tag: tags.comment, color: 'var(--syn-comment)', fontStyle: 'italic' },
    { tag: tags.lineComment, color: 'var(--syn-comment)', fontStyle: 'italic' },
    { tag: tags.blockComment, color: 'var(--syn-comment)', fontStyle: 'italic' },
    { tag: tags.variableName, color: 'var(--syn-variable)' },
    { tag: tags.definition(tags.variableName), color: 'var(--syn-definition)' },
    { tag: tags.propertyName, color: 'var(--syn-property)' },
    { tag: tags.function(tags.variableName), color: 'var(--syn-function)' },
    { tag: tags.function(tags.propertyName), color: 'var(--syn-function)' },
    { tag: tags.typeName, color: 'var(--syn-type)' },
    { tag: tags.standard(tags.typeName), color: 'var(--syn-type)' },
    { tag: tags.namespace, color: 'var(--syn-type)' },
    { tag: tags.className, color: 'var(--syn-type)' },
    { tag: tags.macroName, color: 'var(--syn-macro)' },
    { tag: tags.processingInstruction, color: 'var(--syn-macro)' },
    { tag: tags.meta, color: 'var(--syn-macro)' },
    { tag: tags.operator, color: 'var(--syn-operator)' },
    { tag: tags.punctuation, color: 'var(--syn-punctuation)' },
    { tag: tags.bracket, color: 'var(--syn-punctuation)' },
    { tag: tags.paren, color: 'var(--syn-punctuation)' },
    { tag: tags.labelName, color: 'var(--syn-definition)' },
    { tag: tags.invalid, color: 'var(--danger)' },
  ]),
);

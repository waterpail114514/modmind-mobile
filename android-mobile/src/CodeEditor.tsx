import { useEffect, useRef } from 'react'
import { EditorState, Compartment } from '@codemirror/state'
import { EditorView, lineNumbers, highlightActiveLine, highlightActiveLineGutter, keymap, drawSelection } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { HighlightStyle, syntaxHighlighting, bracketMatching, indentOnInput } from '@codemirror/language'
import { tags } from '@lezer/highlight'
import { java } from '@codemirror/lang-java'
import { json } from '@codemirror/lang-json'
import { markdown } from '@codemirror/lang-markdown'
const highlighting = HighlightStyle.define([
  { tag: tags.keyword, color: 'var(--theme-accent)', fontWeight: '500' },
  { tag: [tags.typeName, tags.className], color: 'var(--theme-text)' },
  { tag: [tags.string, tags.regexp], color: 'var(--theme-success)' },
  { tag: [tags.number, tags.bool, tags.atom], color: 'var(--theme-warning)' },
  { tag: tags.comment, color: 'var(--theme-muted)', fontStyle: 'italic' },
  { tag: tags.invalid, color: 'var(--theme-danger)' }
])

export default function CodeEditor({ value, onChange, file, dark, readOnly = false }: { value: string; onChange(value: string): void; file: string; dark: boolean; readOnly?: boolean }) {
  const container = useRef<HTMLDivElement>(null), editor = useRef<EditorView>(), callback = useRef(onChange)
  const theme = useRef(new Compartment())
  callback.current = onChange
  const skin = (dark: boolean) => EditorView.theme({ '&': { height: '100%', backgroundColor: 'var(--theme-panel)', color: 'var(--theme-text)', fontSize: '14px' }, '.cm-scroller': { fontFamily: 'ui-monospace, monospace', lineHeight: '1.65', overflow: 'auto' }, '.cm-content': { padding: '12px 0', caretColor: 'var(--theme-accent)' }, '.cm-gutters': { backgroundColor: 'var(--theme-panel)', color: 'var(--theme-subtle)', border: 'none', minWidth: '36px' }, '.cm-activeLine, .cm-activeLineGutter': { backgroundColor: 'var(--theme-selected)' }, '.cm-cursor': { borderLeftColor: 'var(--theme-accent)' }, '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': { backgroundColor: 'var(--theme-selection)' }, '&.cm-focused': { outline: 'none' } }, { dark })
  useEffect(() => {
    if (!container.current) return
    const language = file.endsWith('.java') ? java() : /\.(?:json|bbmodel)$/.test(file) ? json() : file.endsWith('.md') ? markdown() : []
    const view = new EditorView({ parent: container.current, state: EditorState.create({ doc: value, extensions: [EditorState.readOnly.of(readOnly), EditorView.editable.of(!readOnly), lineNumbers(), highlightActiveLine(), highlightActiveLineGutter(), drawSelection(), history(), bracketMatching(), indentOnInput(), syntaxHighlighting(highlighting), keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]), theme.current.of(skin(dark)), language, EditorView.contentAttributes.of({ 'aria-label': '文件内容', autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false' }), EditorView.updateListener.of(update => { if (update.docChanged) callback.current(update.state.doc.toString()) })] }) })
    editor.current = view
    return () => { editor.current = undefined; view.destroy() }
  }, [file])
  useEffect(() => { const view = editor.current; if (view && value !== view.state.doc.toString()) view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value } }) }, [value])
  useEffect(() => { editor.current?.dispatch({ effects: theme.current.reconfigure(skin(dark)) }) }, [dark])
  return <div className="code-editor" ref={container} />
}

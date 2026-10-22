'use client'

// CodeMirror with Liquid (HTML inside) highlighting. Uncontrolled: it starts from `value` and reports every
// change; remount it (a new `key`) to load another file or content. Ctrl/Cmd+S calls `onSave`.
import { indentWithTab } from '@codemirror/commands'
import { liquid } from '@codemirror/lang-liquid'
import { Compartment, EditorState, Prec } from '@codemirror/state'
import { oneDark } from '@codemirror/theme-one-dark'
import { EditorView, keymap } from '@codemirror/view'
import { basicSetup } from 'codemirror'
import { useTheme } from 'next-themes'
import { useEffect, useRef } from 'react'

type Props = {
  value: string
  onChange: (value: string) => void
  onSave: () => void
  /** Scrolls to and selects this line (1-based) when it changes */
  line?: number | null
}

const layout = EditorView.theme({
  '&': { height: '100%', fontSize: '13px' },
  '.cm-scroller': { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' },
})

// Background, gutter and active line from the admin's tokens (One Dark keeps only the syntax colors),
// so the editor sits in the page like any other field
const surface = EditorView.theme({
  '&': { backgroundColor: 'var(--card)', color: 'var(--card-foreground)' },
  '&.cm-focused': { outline: 'none' },
  '.cm-gutters': {
    backgroundColor: 'var(--card)',
    color: 'var(--muted-foreground)',
    border: 'none',
    borderRight: '1px solid var(--border)',
  },
  '.cm-activeLine, .cm-activeLineGutter': { backgroundColor: 'color-mix(in oklch, var(--muted) 55%, transparent)' },
})

export function LiquidEditor({ value, onChange, onSave, line }: Props) {
  const parent = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView>(null)
  const colors = useRef(new Compartment())
  const callbacks = useRef({ onChange, onSave })
  callbacks.current = { onChange, onSave }
  const { resolvedTheme } = useTheme()
  const dark = resolvedTheme === 'dark'

  useEffect(() => {
    view.current = new EditorView({
      parent: parent.current!,
      state: EditorState.create({
        doc: value,
        extensions: [
          basicSetup,
          liquid(),
          layout,
          Prec.high(surface),
          colors.current.of(dark ? oneDark : []),
          keymap.of([indentWithTab]),
          Prec.highest(
            keymap.of([
              {
                key: 'Mod-s',
                preventDefault: true,
                run: () => {
                  callbacks.current.onSave()
                  return true
                },
              },
            ]),
          ),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) callbacks.current.onChange(update.state.doc.toString())
          }),
        ],
      }),
    })
    return () => view.current?.destroy()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- uncontrolled: `value` is only the start
  }, [])

  useEffect(() => {
    view.current?.dispatch({ effects: colors.current.reconfigure(dark ? oneDark : []) })
  }, [dark])

  useEffect(() => {
    const editor = view.current
    if (!editor || !line || line > editor.state.doc.lines) return
    const { from, to } = editor.state.doc.line(line)
    editor.dispatch({ selection: { anchor: from, head: to }, scrollIntoView: true })
    editor.focus()
  }, [line])

  // Positioned, so long lines can't widen the page (they scroll inside the editor)
  return (
    <div className="relative h-full">
      <div ref={parent} className="absolute inset-0" />
    </div>
  )
}

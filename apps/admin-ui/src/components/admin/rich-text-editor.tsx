'use client'

// Rich text for merchant content (pages; product and collection descriptions later). Edits HTML, which
// the API sanitizes on save. "HTML" switches to the source, for pasting embeds or fixing markup.
import Image from '@tiptap/extension-image'
import { EditorContent, useEditor, useEditorState, type Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import {
  BoldIcon,
  CodeXmlIcon,
  Heading2Icon,
  Heading3Icon,
  ImageIcon,
  ItalicIcon,
  LinkIcon,
  ListIcon,
  ListOrderedIcon,
  QuoteIcon,
  Redo2Icon,
  UnderlineIcon,
  Undo2Icon,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'

// Content styles (no typography plugin in the admin)
const contentClass = cn(
  'h-64 max-h-96 overflow-y-auto px-3 py-2 text-sm outline-none',
  '[&_h2]:mt-4 [&_h2]:mb-2 [&_h2]:text-xl [&_h2]:font-semibold [&_h3]:mt-3 [&_h3]:mb-2 [&_h3]:text-lg [&_h3]:font-semibold',
  '[&_p]:my-2 [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-6',
  '[&_blockquote]:my-2 [&_blockquote]:border-l-2 [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground',
  '[&_a]:text-primary [&_a]:underline [&_img]:my-2 [&_img]:max-h-80 [&_img]:rounded-md',
  '[&_hr]:my-4 [&_code]:rounded [&_code]:bg-muted [&_code]:px-1',
)

type Prompt = 'link' | 'image' | null

export function RichTextEditor({
  id,
  value,
  onChange,
  invalid,
}: {
  id?: string
  value: string
  onChange: (html: string) => void
  invalid?: boolean
}) {
  const [source, setSource] = useState(false)
  const [prompt, setPrompt] = useState<Prompt>(null)
  const [promptValue, setPromptValue] = useState('')

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [2, 3] },
        link: { openOnClick: false, autolink: true, protocols: ['http', 'https', 'mailto'] },
      }),
      Image,
    ],
    content: value,
    // Rendered on the client only (Next prerenders the page)
    immediatelyRender: false,
    editorProps: { attributes: { class: contentClass, ...(id && { id }), 'aria-multiline': 'true' } },
    onUpdate: ({ editor }) => onChange(editor.isEmpty ? '' : editor.getHTML()),
  })

  // A new value from outside (form reset, HTML mode) replaces the content
  useEffect(() => {
    if (!editor || source) return
    const current = editor.isEmpty ? '' : editor.getHTML()
    if (value !== current) editor.commands.setContent(value, { emitUpdate: false })
  }, [editor, value, source])

  function openPrompt(kind: Exclude<Prompt, null>) {
    setPromptValue(kind === 'link' ? (editor?.getAttributes('link').href ?? '') : '')
    setPrompt(kind)
  }

  function applyPrompt() {
    if (!editor) return
    const url = promptValue.trim()
    if (prompt === 'link') {
      if (url) editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run()
      else editor.chain().focus().extendMarkRange('link').unsetLink().run()
    } else if (prompt === 'image' && url) {
      editor.chain().focus().setImage({ src: url }).run()
    }
    setPrompt(null)
  }

  return (
    <div className={cn('overflow-hidden rounded-lg bg-card shadow-field', invalid && 'ring-1 ring-destructive')}>
      <div className="flex flex-wrap items-center gap-0.5 border-b p-1">
        {editor && !source && <Formatting editor={editor} onPrompt={openPrompt} />}
        <Button
          type="button"
          variant={source ? 'secondary' : 'ghost'}
          size="sm"
          className="ml-auto"
          aria-pressed={source}
          onClick={() => setSource(!source)}
        >
          <CodeXmlIcon />
          HTML
        </Button>
      </div>
      {prompt && (
        <div className="flex items-center gap-2 border-b p-2">
          <Input
            autoFocus
            value={promptValue}
            placeholder={
              prompt === 'link' ? 'https://… or /pages/about (empty removes the link)' : 'Image URL (https://…)'
            }
            onChange={(e) => setPromptValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                applyPrompt()
              }
              if (e.key === 'Escape') setPrompt(null)
            }}
          />
          <Button type="button" size="sm" onClick={applyPrompt}>
            {prompt === 'link' ? 'Apply' : 'Insert'}
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setPrompt(null)}>
            Cancel
          </Button>
        </div>
      )}
      {source ? (
        <Textarea
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          spellCheck={false}
          className="h-64 max-h-96 min-h-0 field-sizing-fixed resize-none overflow-y-auto rounded-none border-0 px-3 py-2 text-sm leading-5 font-mono shadow-none focus-visible:ring-0"
        />
      ) : (
        <EditorContent editor={editor} />
      )}
    </div>
  )
}

function Formatting({ editor, onPrompt }: { editor: Editor; onPrompt: (kind: 'link' | 'image') => void }) {
  // Re-renders the toolbar when the selection's formatting changes
  const state = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive('bold'),
      italic: e.isActive('italic'),
      underline: e.isActive('underline'),
      h2: e.isActive('heading', { level: 2 }),
      h3: e.isActive('heading', { level: 3 }),
      bulletList: e.isActive('bulletList'),
      orderedList: e.isActive('orderedList'),
      blockquote: e.isActive('blockquote'),
      link: e.isActive('link'),
      canUndo: e.can().undo(),
      canRedo: e.can().redo(),
    }),
  })

  const tool = (label: string, icon: React.ReactNode, active: boolean, run: () => void, disabled = false) => (
    <Button
      type="button"
      variant={active ? 'secondary' : 'ghost'}
      size="icon-sm"
      aria-label={label}
      title={label}
      aria-pressed={active}
      disabled={disabled}
      onClick={run}
    >
      {icon}
    </Button>
  )
  const chain = () => editor.chain().focus()

  return (
    <>
      {tool('Bold', <BoldIcon />, state.bold, () => chain().toggleBold().run())}
      {tool('Italic', <ItalicIcon />, state.italic, () => chain().toggleItalic().run())}
      {tool('Underline', <UnderlineIcon />, state.underline, () => chain().toggleUnderline().run())}
      {tool('Heading', <Heading2Icon />, state.h2, () => chain().toggleHeading({ level: 2 }).run())}
      {tool('Subheading', <Heading3Icon />, state.h3, () => chain().toggleHeading({ level: 3 }).run())}
      {tool('Bulleted list', <ListIcon />, state.bulletList, () => chain().toggleBulletList().run())}
      {tool('Numbered list', <ListOrderedIcon />, state.orderedList, () => chain().toggleOrderedList().run())}
      {tool('Quote', <QuoteIcon />, state.blockquote, () => chain().toggleBlockquote().run())}
      {tool('Link', <LinkIcon />, state.link, () => onPrompt('link'))}
      {tool('Image', <ImageIcon />, false, () => onPrompt('image'))}
      {tool('Undo', <Undo2Icon />, false, () => chain().undo().run(), !state.canUndo)}
      {tool('Redo', <Redo2Icon />, false, () => chain().redo().run(), !state.canRedo)}
    </>
  )
}

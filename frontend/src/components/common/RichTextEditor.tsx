import { useEffect, useRef } from 'react'
import {
  Bold, Italic, Underline, Strikethrough,
  List, ListOrdered, AlignLeft, AlignCenter,
  AlignRight, Link as LinkIcon, RemoveFormatting,
} from 'lucide-react'

interface RichTextEditorProps {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  minHeight?: string
}

export function RichTextEditor({
  value,
  onChange,
  placeholder = 'Write mail content here...',
  minHeight = '180px',
}: RichTextEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null)

  // Sync internal HTML content when value changes externally (e.g. template reset)
  useEffect(() => {
    if (editorRef.current && editorRef.current.innerHTML !== value) {
      editorRef.current.innerHTML = value || ''
    }
  }, [value])

  const format = (command: string, val: string | undefined = undefined) => {
    document.execCommand(command, false, val)
    if (editorRef.current) {
      onChange(editorRef.current.innerHTML)
    }
  }

  const handleInput = () => {
    if (editorRef.current) {
      onChange(editorRef.current.innerHTML)
    }
  }

  const addLink = () => {
    const url = prompt('Enter link URL:')
    if (url) {
      format('createLink', url)
    }
  }

  return (
    <div className="border rounded-md overflow-hidden bg-background border-input focus-within:ring-2 focus-within:ring-ring focus-within:border-primary">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-1 p-1.5 bg-muted/40 border-b text-muted-foreground select-none">
        <button
          type="button"
          onClick={() => format('bold')}
          title="Bold"
          className="p-1.5 hover:bg-background hover:text-foreground rounded transition-colors"
        >
          <Bold className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => format('italic')}
          title="Italic"
          className="p-1.5 hover:bg-background hover:text-foreground rounded transition-colors"
        >
          <Italic className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => format('underline')}
          title="Underline"
          className="p-1.5 hover:bg-background hover:text-foreground rounded transition-colors"
        >
          <Underline className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => format('strikeThrough')}
          title="Strikethrough"
          className="p-1.5 hover:bg-background hover:text-foreground rounded transition-colors"
        >
          <Strikethrough className="h-4 w-4" />
        </button>

        <div className="h-4 w-px bg-border mx-1" />

        <button
          type="button"
          onClick={() => format('insertUnorderedList')}
          title="Bullet List"
          className="p-1.5 hover:bg-background hover:text-foreground rounded transition-colors"
        >
          <List className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => format('insertOrderedList')}
          title="Numbered List"
          className="p-1.5 hover:bg-background hover:text-foreground rounded transition-colors"
        >
          <ListOrdered className="h-4 w-4" />
        </button>

        <div className="h-4 w-px bg-border mx-1" />

        <button
          type="button"
          onClick={() => format('justifyLeft')}
          title="Align Left"
          className="p-1.5 hover:bg-background hover:text-foreground rounded transition-colors"
        >
          <AlignLeft className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => format('justifyCenter')}
          title="Align Center"
          className="p-1.5 hover:bg-background hover:text-foreground rounded transition-colors"
        >
          <AlignCenter className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => format('justifyRight')}
          title="Align Right"
          className="p-1.5 hover:bg-background hover:text-foreground rounded transition-colors"
        >
          <AlignRight className="h-4 w-4" />
        </button>

        <div className="h-4 w-px bg-border mx-1" />

        <button
          type="button"
          onClick={addLink}
          title="Insert Link"
          className="p-1.5 hover:bg-background hover:text-foreground rounded transition-colors"
        >
          <LinkIcon className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => format('removeFormat')}
          title="Remove Formatting"
          className="p-1.5 hover:bg-background hover:text-foreground rounded transition-colors"
        >
          <RemoveFormatting className="h-4 w-4" />
        </button>
      </div>

      {/* Editor Body */}
      <div
        ref={editorRef}
        contentEditable
        onInput={handleInput}
        style={{ minHeight }}
        data-placeholder={placeholder}
        className="p-3 text-sm focus:outline-none overflow-y-auto leading-relaxed"
      />
    </div>
  )
}

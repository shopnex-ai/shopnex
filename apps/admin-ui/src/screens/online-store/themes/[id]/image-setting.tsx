// The theme editor's input for an `image` setting: upload a file, or paste an image URL. The stored value is the URL either way.
import { ImageIcon, Upload, X } from 'lucide-react'
import { useRef, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { isShowableImage, storedImageUrl } from '@/lib/image-url'
import { client } from '@/lib/orpc'

const ACCEPT = 'image/jpeg,image/png,image/gif,image/webp,image/avif'

export function ImageSetting({
  id,
  value,
  onChange,
}: {
  id: string
  value: string
  onChange: (value: string) => void
}) {
  const input = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [dragging, setDragging] = useState(false)

  const upload = async (file: File | undefined) => {
    if (!file) return
    setUploading(true)
    try {
      const saved = await client.admin.files.upload({ file })
      onChange(storedImageUrl(saved.url, window.location.origin))
    } catch (error) {
      toast.error(`${file.name}: ${error instanceof Error ? error.message : 'Upload failed'}`)
    } finally {
      setUploading(false)
    }
  }

  return (
    <div
      className={`space-y-2 rounded-md ${dragging ? 'ring-2 ring-primary ring-offset-2' : ''}`}
      onDragOver={(e) => {
        e.preventDefault()
        setDragging(true)
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault()
        setDragging(false)
        void upload(e.dataTransfer.files[0])
      }}
    >
      {isShowableImage(value) && (
        <img
          src={value}
          alt=""
          referrerPolicy="no-referrer"
          className="h-24 w-full rounded-md border bg-muted object-contain"
        />
      )}
      <div className="flex gap-2">
        <Button type="button" variant="outline" size="sm" disabled={uploading} onClick={() => input.current?.click()}>
          {value ? <ImageIcon /> : <Upload />}
          {uploading ? 'Uploading…' : value ? 'Replace' : 'Upload'}
        </Button>
        {value && (
          <Button type="button" variant="ghost" size="sm" onClick={() => onChange('')}>
            <X />
            Remove
          </Button>
        )}
        <input
          ref={input}
          type="file"
          accept={ACCEPT}
          hidden
          onChange={(e) => {
            void upload(e.target.files?.[0])
            e.target.value = ''
          }}
        />
      </div>
      <Input
        id={id}
        value={value}
        placeholder="or paste an image URL: https://…"
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  )
}

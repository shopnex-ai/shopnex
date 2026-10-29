'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ImageIcon, Upload, X } from 'lucide-react'
import { useRef, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { client, orpc } from '@/lib/orpc'
import { GenerateImageAlt } from './ai-generate'
import type { Product } from './product-detail'

const ACCEPT = 'image/jpeg,image/png,image/gif,image/webp,image/avif'

// Images save right away (like Shopify's media), separately from the product form
export function MediaCard({ product }: { product: Product }) {
  const queryClient = useQueryClient()
  const input = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(0)
  const [dragging, setDragging] = useState(false)
  const update = useMutation(orpc.admin.products.update.mutationOptions())
  const productKey = orpc.admin.products.get.queryKey({ input: { id: product.id } })

  const saveImages = async (images: { url: string; alt: string | null }[]) => {
    const saved = await update.mutateAsync({ id: product.id, images })
    queryClient.setQueryData(productKey, saved)
    await queryClient.invalidateQueries({ queryKey: orpc.admin.products.list.key() })
  }

  // Latest images from the cache, so back-to-back uploads and removals don't overwrite each other
  const currentImages = () =>
    (queryClient.getQueryData<Product>(productKey) ?? product).images.map(({ url, alt }) => ({ url, alt }))

  const upload = async (files: File[]) => {
    if (!files.length) return
    setUploading(files.length)
    const uploaded: { url: string; alt: string | null }[] = []
    for (const file of files) {
      try {
        const saved = await client.admin.files.upload({ file })
        uploaded.push({ url: saved.url, alt: saved.alt })
      } catch (error) {
        toast.error(`${file.name}: ${error instanceof Error ? error.message : 'Upload failed'}`)
      }
      setUploading((n) => n - 1)
    }
    if (!uploaded.length) return
    try {
      await saveImages([...currentImages(), ...uploaded])
      toast.success(uploaded.length === 1 ? 'Image added' : `${uploaded.length} images added`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not save images')
    }
  }

  const remove = async (index: number) => {
    try {
      await saveImages(currentImages().filter((_, i) => i !== index))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not remove image')
    }
  }

  return (
    <Card
      onDragOver={(e) => {
        e.preventDefault()
        setDragging(true)
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault()
        setDragging(false)
        void upload([...e.dataTransfer.files])
      }}
      className={dragging ? 'ring-2 ring-primary' : undefined}
    >
      <CardHeader>
        <CardTitle>Media</CardTitle>
        <CardAction className="flex gap-2">
          <GenerateImageAlt
            productId={product.id}
            images={product.images}
            onUse={async (alts) => {
              // Saved right away like the other media changes; images that weren't described keep their alt text
              const images = currentImages().map((image, position) => ({
                ...image,
                alt: alts.find((a) => a.position === position)?.alt ?? image.alt,
              }))
              try {
                await saveImages(images)
                toast.success(alts.length === 1 ? 'Alt text saved' : `Alt text saved for ${alts.length} images`)
              } catch (error) {
                toast.error(error instanceof Error ? error.message : 'Could not save alt text')
              }
            }}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={uploading > 0}
            onClick={() => input.current?.click()}
          >
            <Upload />
            {uploading ? `Uploading ${uploading}…` : 'Add images'}
          </Button>
          <input
            ref={input}
            type="file"
            accept={ACCEPT}
            multiple
            hidden
            onChange={(e) => {
              void upload([...(e.target.files ?? [])])
              e.target.value = ''
            }}
          />
        </CardAction>
      </CardHeader>
      <CardContent>
        {product.images.length ? (
          <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
            {product.images.map((img, i) => (
              <div
                key={img.id}
                className={`group relative overflow-hidden rounded-lg border bg-muted ${i === 0 ? 'col-span-2 row-span-2' : ''}`}
              >
                <img src={img.url} alt={img.alt ?? ''} className="aspect-square size-full object-cover" />
                <Button
                  type="button"
                  variant="secondary"
                  size="icon"
                  aria-label="Remove image"
                  disabled={update.isPending}
                  onClick={() => void remove(i)}
                  className="absolute top-1.5 right-1.5 size-7 opacity-0 shadow-sm group-hover:opacity-100 focus-visible:opacity-100"
                >
                  <X />
                </Button>
              </div>
            ))}
          </div>
        ) : (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <ImageIcon className="size-4" />
            No images. Add some, or drop them here.
          </div>
        )}
      </CardContent>
    </Card>
  )
}

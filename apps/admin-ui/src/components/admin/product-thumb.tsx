import { ImageIcon } from 'lucide-react'
import { useState } from 'react'
import { cn } from 'cn'

/**
 * A product's picture. The box shows its placeholder (a quiet image icon) while the picture loads, and keeps it when
 * the product has no picture or the address does not load, so there is never a broken-image icon or alt text in it.
 * The product's name is next to the picture, so the picture itself is decorative.
 */
export function ProductThumb({ src, className }: { src?: string | null; className?: string }) {
  const [state, setState] = useState<'loading' | 'loaded' | 'failed'>('loading')
  // A different address starts over
  const [shown, setShown] = useState(src)
  if (src !== shown) {
    setShown(src)
    setState('loading')
  }
  return (
    <div
      className={cn(
        'relative flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted text-muted-foreground/60 ring-1 ring-foreground/10 ring-inset',
        className,
      )}
    >
      <ImageIcon className={cn('size-5', state === 'loaded' && 'invisible')} strokeWidth={1.5} />
      {src && state !== 'failed' && (
        <img
          src={src}
          alt=""
          loading="lazy"
          className={cn(
            'absolute inset-0 size-full object-cover transition-opacity duration-150',
            state === 'loaded' ? 'opacity-100' : 'opacity-0',
          )}
          onLoad={() => setState('loaded')}
          onError={() => setState('failed')}
          // The page can be rendered by the server before React is there to hear the load or error event
          ref={(img) => {
            if (img?.complete) setState(img.naturalWidth > 0 ? 'loaded' : 'failed')
          }}
        />
      )}
    </div>
  )
}

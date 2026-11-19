import { ImageIcon } from 'lucide-react'
import { useState } from 'react'
import { cn } from 'cn'

/** A product's picture; a quiet placeholder when it has none, or when its address does not load */
export function ProductThumb({ src, alt = '', className }: { src?: string | null; alt?: string; className?: string }) {
  const [failed, setFailed] = useState(false)
  // A different address gets another try
  const [shown, setShown] = useState(src)
  if (src !== shown) {
    setShown(src)
    setFailed(false)
  }
  return (
    <div
      className={cn(
        'flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted text-muted-foreground/60 ring-1 ring-foreground/10 ring-inset',
        className,
      )}
    >
      {src && !failed ? (
        <img
          src={src}
          alt={alt}
          loading="lazy"
          className="size-full object-cover"
          onError={() => setFailed(true)}
          // The page can be rendered by the server before React is there to hear the error event
          ref={(img) => {
            if (img?.complete && img.naturalWidth === 0) setFailed(true)
          }}
        />
      ) : (
        <ImageIcon className="size-5" strokeWidth={1.5} />
      )}
    </div>
  )
}

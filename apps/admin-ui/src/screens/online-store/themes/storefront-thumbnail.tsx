'use client'

// A theme's picture: the storefront rendered at desktop size and scaled down to fit. On the Themes page it's
// the live store (what buyers see); in Change theme, each copy's draft. Not interactive; clicking it opens the
// editor.
import { Link } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

// The page is laid out at this size, then scaled to the thumbnail's width
const VIEWPORT = { width: 1280, height: 800 }

// `url` is null while it isn't known yet (a preview token loading)
export function StorefrontThumbnail({ url, themeId }: { url: string | null; themeId: string }) {
  const box = useRef<HTMLAnchorElement>(null)
  const [scale, setScale] = useState(0)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    const el = box.current
    if (!el) return
    const observer = new ResizeObserver(([entry]) => setScale(entry!.contentRect.width / VIEWPORT.width))
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  return (
    <Link
      ref={box}
      to="/admin/online-store/themes/$id"
      params={{ id: themeId }}
      aria-label="Customize theme"
      className="relative block aspect-[16/10] w-full overflow-hidden rounded-md border bg-muted ring-offset-background transition hover:ring-2 hover:ring-ring hover:ring-offset-2"
    >
      {!loaded && <Skeleton className="absolute inset-0 rounded-none" />}
      {scale > 0 && url && (
        <iframe
          src={url}
          title="Your storefront"
          loading="lazy"
          tabIndex={-1}
          aria-hidden
          onLoad={() => setLoaded(true)}
          className={cn(
            'pointer-events-none origin-top-left border-0 bg-white transition-opacity',
            loaded ? 'opacity-100' : 'opacity-0',
          )}
          style={{ width: VIEWPORT.width, height: VIEWPORT.height, transform: `scale(${scale})` }}
        />
      )}
    </Link>
  )
}

'use client'

// The real storefront in an iframe, showing the draft (preview token in the URL). After each save the
// editor bumps `reloadKey`; the theme's preview script (`connectThemePreview` from
// @shopnex/storefront-sdk/theme-preview) reloads in place and keeps its scroll position. A theme that never says "ready" isn't reading the draft: we
// reload the whole iframe instead and tell the merchant why their changes might not show.
import { useEffect, useRef, useState } from 'react'
import {
  THEME_EDITOR_SOURCE,
  THEME_PREVIEW_PARAM,
  isThemePreviewMessage,
  type ThemeEditorMessage,
} from '@shopnex/storefront-sdk/theme-preview'
import { client } from '@/lib/orpc'
import { cn } from '@/lib/utils'

// Tokens last an hour; renew well before that
const TOKEN_REFRESH_MS = 45 * 60 * 1000
const READY_TIMEOUT_MS = 8000

type DistributiveOmit<T, K extends keyof T> = T extends unknown ? Omit<T, K> : never

type Props = {
  storefrontUrl: string
  /** The library copy to preview (its draft) */
  copyId: string
  reloadKey: number
  selectedSectionId: string | null
  device: 'desktop' | 'mobile'
}

export function PreviewFrame({ storefrontUrl, copyId, reloadKey, selectedSectionId, device }: Props) {
  const frame = useRef<HTMLIFrameElement>(null)
  const origin = new URL(storefrontUrl).origin
  const [token, setToken] = useState<string | null>(null)
  const [hardReloads, setHardReloads] = useState(0)
  const [ready, setReady] = useState(false)
  const [noBridge, setNoBridge] = useState(false)
  const selected = useRef(selectedSectionId)
  selected.current = selectedSectionId

  const post = (message: DistributiveOmit<ThemeEditorMessage, 'source'>) =>
    frame.current?.contentWindow?.postMessage({ source: THEME_EDITOR_SOURCE, ...message }, origin)

  useEffect(() => {
    let cancelled = false
    const renew = () => client.admin.themes.previewToken({ id: copyId }).then((t) => !cancelled && setToken(t.token))
    renew()
    const timer = setInterval(renew, TOKEN_REFRESH_MS)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [copyId])

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (event.source !== frame.current?.contentWindow || event.origin !== origin) return
      if (!isThemePreviewMessage(event.data)) return
      setReady(true)
      setNoBridge(false)
      if (selected.current) post({ type: 'select', sectionId: selected.current })
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `post` only reads refs
  }, [origin])

  // A new src (token renewed) or a hard reload loads a fresh page, which has to say "ready" again
  useEffect(() => setReady(false), [token, hardReloads])
  useEffect(() => {
    if (!token || ready) return
    const timer = setTimeout(() => setNoBridge(true), READY_TIMEOUT_MS)
    return () => clearTimeout(timer)
  }, [token, ready, hardReloads])

  useEffect(() => {
    if (reloadKey === 0) return
    if (ready) post({ type: 'reload' })
    else setHardReloads((n) => n + 1)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only on a new save
  }, [reloadKey])

  useEffect(() => {
    if (ready && selectedSectionId) post({ type: 'select', sectionId: selectedSectionId })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSectionId, ready])

  const src = token ? `${storefrontUrl.replace(/\/$/, '')}/?${THEME_PREVIEW_PARAM}=${encodeURIComponent(token)}` : null

  return (
    <div className="flex h-full flex-col">
      {noBridge && (
        <p className="border-b bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:bg-amber-950 dark:text-amber-200">
          The storefront isn&apos;t showing your draft. Check that it is connected to this Shopnex (in the bundled
          template: COMMERCE_PROVIDER=shopnex) and that its theme supports the editor.
        </p>
      )}
      <div className="flex flex-1 justify-center overflow-hidden bg-muted/40 p-3">
        {src ? (
          <iframe
            key={hardReloads}
            ref={frame}
            src={src}
            title="Storefront preview"
            className={cn(
              'h-full rounded-md border bg-white shadow-sm transition-[width]',
              device === 'mobile' ? 'w-[390px]' : 'w-full',
            )}
          />
        ) : (
          <div className="flex items-center text-sm text-muted-foreground">Loading preview…</div>
        )}
      </div>
    </div>
  )
}

import { ErrorComponent } from '@tanstack/react-router'
import type { ErrorComponentProps } from '@tanstack/react-router'
import { useEffect } from 'react'
import { NotFound } from '@/components/not-found'
import { Button } from '@/components/ui/button'
import { isMissing } from '@/lib/not-found'
import { isStaleChunkError, reloadForNewBuild } from '@/lib/stale-chunk'

export function RouteError({ error }: ErrorComponentProps) {
  const stale = isStaleChunkError(error)

  useEffect(() => {
    if (stale) reloadForNewBuild()
  }, [stale])

  // A loader that let the API's "no such record" through: say so, as the not-found page does
  if (!stale) return isMissing(error) ? <NotFound /> : <ErrorComponent error={error} />

  return (
    <div className="flex flex-col items-start gap-3 p-6">
      <h1 className="text-lg font-semibold">A new version of ShopNex is available</h1>
      <p className="text-muted-foreground text-sm">Reload the page to continue.</p>
      <Button onClick={() => window.location.reload()}>Reload</Button>
    </div>
  )
}

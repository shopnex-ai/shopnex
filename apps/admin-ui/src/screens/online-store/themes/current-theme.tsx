'use client'

import { useQuery } from '@tanstack/react-query'
import { TriangleAlertIcon } from 'lucide-react'
import { Link } from '@tanstack/react-router'
import { PageHeader } from '@/components/admin/page-header'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { formatDate } from '@/lib/format'
import { orpc } from '@/lib/orpc'
import type { Storefront } from './definition'
import { StorefrontThumbnail } from './storefront-thumbnail'
import type { Theme } from './theme-dialogs'

type Props = {
  /** The storefront's themes; null when it can't be reached */
  storefront: Storefront | null
  storefrontError: React.ReactNode
}

function status(theme: Theme) {
  if (!theme.publishedAt) return 'Not published yet: buyers see the theme’s defaults'
  const published = `Published ${formatDate(theme.publishedAt)}`
  return theme.unpublishedChanges ? `${published} · unpublished changes` : published
}

export function CurrentTheme({ storefront, storefrontError }: Props) {
  const { data, error, isPending } = useQuery(orpc.admin.themes.list.queryOptions())
  const current = data?.find((t) => t.role === 'live')
  const theme = current && storefront?.themes.find((d) => d.id === current.themeId)
  // A live copy of a theme the storefront doesn't include: it falls back to its default theme
  const missing = !!current && !!storefront && !theme

  return (
    <div className="space-y-4">
      <PageHeader
        title="Themes"
        description="How your online store looks"
        actions={
          <Button
            variant="outline"
            size="sm"
            nativeButton={false}
            render={<Link to="/admin/online-store/themes/select" />}
          >
            Change theme
          </Button>
        }
      />

      {!storefront && (
        <Card>
          <CardContent className="flex gap-3 text-sm text-muted-foreground">
            <TriangleAlertIcon className="mt-0.5 size-4 shrink-0 text-amber-600" />
            <p>{storefrontError}</p>
          </CardContent>
        </Card>
      )}

      {error ? (
        <Card>
          <CardContent className="text-sm text-destructive">{error.message}</CardContent>
        </Card>
      ) : isPending ? (
        <Skeleton className="h-32 w-full" />
      ) : !current ? (
        <Card>
          <CardContent className="text-sm text-muted-foreground">
            No theme yet. It’s added when Shopnex can reach your storefront.
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="grid gap-6 md:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] md:items-center">
            {storefront ? (
              <StorefrontThumbnail url={storefront.url} themeId={current.id} />
            ) : (
              <div className="flex aspect-[16/10] items-center justify-center rounded-md border bg-muted text-sm text-muted-foreground">
                No preview
              </div>
            )}
            <div className="min-w-0 space-y-4">
              <div className="space-y-1">
                <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Current theme</p>
                <p className="flex items-center gap-2 text-lg font-semibold">
                  <span className="truncate">{current.name}</span>
                  <Badge variant="secondary">Live</Badge>
                </p>
                <p className="text-sm text-muted-foreground">
                  {theme && current.name !== theme.name && `${theme.name} theme · `}
                  {status(current)}
                </p>
                {missing && (
                  <p className="text-sm text-amber-700 dark:text-amber-400">
                    Your storefront doesn’t include this theme, so buyers see {storefront.themes[0]!.name}’s defaults.
                    Choose another one under Change theme.
                  </p>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                {theme ? (
                  <Button
                    nativeButton={false}
                    render={<Link to="/admin/online-store/themes/$id" params={{ id: current.id }} />}
                  >
                    Customize
                  </Button>
                ) : (
                  <Button
                    disabled
                    title={
                      storefront ? 'Your storefront doesn’t include this theme' : 'Your storefront can’t be reached'
                    }
                  >
                    Customize
                  </Button>
                )}
                {storefront && (
                  <Button
                    variant="outline"
                    nativeButton={false}
                    render={<a href={storefront.url} target="_blank" rel="noopener" />}
                  >
                    View store
                  </Button>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

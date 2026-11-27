import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { TriangleAlertIcon } from 'lucide-react'
import { Link } from '@tanstack/react-router'
import { toast } from 'sonner'
import { PageHeader } from '@/components/admin/page-header'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { formatDate } from '@/lib/format'
import { orpc } from '@/lib/orpc'
import type { Storefront } from './definition'
import { StorefrontThumbnail } from './storefront-thumbnail'
import { useThemeDialogs, type Theme } from './theme-dialogs'
import { ThemeMenu, copySettings } from './theme-menu'

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
  const queryClient = useQueryClient()
  const { data, error, isPending } = useQuery(orpc.admin.themes.list.queryOptions())
  const { open, dialogs } = useThemeDialogs()
  const duplicate = useMutation(
    orpc.admin.themes.duplicate.mutationOptions({
      onSuccess: (copy) => {
        toast.success(`Added ${copy.name}`)
        return queryClient.invalidateQueries({ queryKey: orpc.admin.themes.key() })
      },
      onError: (e) => toast.error(e.message),
    }),
  )
  const current = data?.find((t) => t.role === 'live')
  const theme = current && storefront?.themes.find((d) => d.id === current.themeId)
  // A live copy of a theme the storefront doesn't include: it falls back to its default theme
  const missing = !!current && !!storefront && !theme

  return (
    <div className="space-y-4">
      <PageHeader title="Online store" />

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
            No theme yet. It’s added when ShopNex can reach your storefront.
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="grid gap-6 md:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] md:items-center">
            {storefront ? (
              // The live store itself (what buyers see now), not the theme's picture
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
                    Choose another one under Your themes.
                  </p>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                {theme ? (
                  <Button
                    nativeButton={false}
                    render={<Link to="/admin/online-store/editor/$id" params={{ id: current.id }} />}
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
                <ThemeMenu
                  theme={current}
                  onRename={() => open('rename', current)}
                  onDuplicate={() => duplicate.mutate({ id: current.id })}
                  onCopySettings={() => copySettings(current)}
                  onDelete={() => open('delete', current)}
                />
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {dialogs}
    </div>
  )
}

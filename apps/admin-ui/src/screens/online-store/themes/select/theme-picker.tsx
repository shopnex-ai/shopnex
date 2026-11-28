// Online store → Your themes (under the current theme, which isn't repeated here): the shop's other themes. Copies of the themes the storefront includes
// can be customized and used (published); copies of others wait for a storefront with their theme. The
// storefront's themes without a copy yet can be added. Marketplace themes will be listed here too.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { THEME_PREVIEW_PARAM } from '@shopnex/storefront-sdk/theme-preview'
import { ExternalLinkIcon, PlusIcon } from 'lucide-react'
import { Link } from '@tanstack/react-router'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { formatDate } from '@/lib/format'
import { orpc } from '@/lib/orpc'
import type { Storefront } from '../definition'
import { StorefrontThumbnail } from '../storefront-thumbnail'
import { useThemeDialogs, type Theme } from '../theme-dialogs'
import { ThemeMenu, copySettings } from '../theme-menu'

type Props = {
  /** The storefront's themes; null when it can't be reached */
  storefront: Storefront | null
}

export function ThemePicker({ storefront }: Props) {
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

  const store = useQuery(orpc.admin.themes.store.queryOptions())
  const addFromStore = useMutation(
    orpc.admin.themes.addFromStore.mutationOptions({
      onSuccess: (copy) => {
        toast.success(`Added ${copy.name}. Customize it, then use it when it’s ready.`)
        return queryClient.invalidateQueries({ queryKey: orpc.admin.themes.key() })
      },
      onError: (e) => toast.error(e.message),
    }),
  )

  const add = useMutation(
    orpc.admin.themes.add.mutationOptions({
      onSuccess: (copy) => {
        toast.success(`Added ${copy.name}. It starts from the theme’s defaults.`)
        return queryClient.invalidateQueries({ queryKey: orpc.admin.themes.key() })
      },
      onError: (e) => toast.error(e.message),
    }),
  )

  // While the storefront can't be reached, every theme counts as included
  const themeOf = (t: Theme) => storefront?.themes.find((d) => d.id === t.themeId)
  const ours = data?.filter((t) => !storefront || themeOf(t)) ?? []
  const others = data?.filter((t) => storefront && !themeOf(t)) ?? []
  // Every theme the storefront includes can be added again: each copy starts from the theme's defaults
  const available = storefront?.themes ?? []
  const copiesOf = (themeId: string) => data?.filter((t) => t.themeId === themeId).length ?? 0
  // The name of a new copy: the theme's own, then "Name 2", "Name 3"… so copies can be told apart
  const nameForNewCopy = (name: string) => {
    const taken = new Set(data?.map((t) => t.name))
    let candidate = name
    for (let n = 2; taken.has(candidate); n++) candidate = `${name} ${n}`
    return candidate
  }
  const current = ours.find((t) => t.role === 'live')
  // The current theme has its own card above, with the same menu
  const library = ours.filter((t) => t.role !== 'live')
  // Styles for themes the storefront includes (all of them while it can't be reached, to show what's there)
  const styles = store.data?.filter((s) => !storefront || storefront.themes.some((d) => d.id === s.baseThemeId)) ?? []
  const baseName = (id: string) => storefront?.themes.find((d) => d.id === id)?.name ?? id

  return (
    <div className="space-y-4">
      {error ? (
        <Card>
          <CardContent className="text-sm text-destructive">{error.message}</CardContent>
        </Card>
      ) : isPending ? (
        <Skeleton className="h-40 w-full" />
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Your themes</CardTitle>
              <CardDescription>Customize one without touching your store, then use it when it’s ready</CardDescription>
              {storefront && current && (
                <CardAction>
                  <Button size="sm" disabled={duplicate.isPending} onClick={() => duplicate.mutate({ id: current.id })}>
                    <PlusIcon />
                    Copy current theme
                  </Button>
                </CardAction>
              )}
            </CardHeader>
            <CardContent>
              {library.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  No other themes yet. Copy the current theme to try changes without touching your store.
                </p>
              )}
              <ul className="divide-y">
                {library.map((t) => (
                  <li key={t.id} className="flex flex-wrap items-center gap-3 py-3 first:pt-0 last:pb-0">
                    <div className="w-40 shrink-0">
                      {storefront && themeOf(t) ? (
                        <ThemeThumbnail storefrontUrl={storefront.url} theme={t} screenshot={themeOf(t)?.screenshot} />
                      ) : (
                        <div className="flex aspect-[16/10] items-center justify-center rounded-md border bg-muted text-xs text-muted-foreground">
                          No preview
                        </div>
                      )}
                    </div>
                    <div className="mr-auto min-w-0">
                      <p className="flex items-center gap-2 font-medium">
                        <span className="truncate">{t.name}</span>
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {themeOf(t) && themeOf(t)!.name !== t.name && `${themeOf(t)!.name} theme · `}
                        Edited {formatDate(t.updatedAt)}
                      </p>
                    </div>
                    <Button variant="outline" size="sm" disabled={!storefront} onClick={() => open('publish', t)}>
                      Use theme
                    </Button>
                    <CustomizeButton theme={t} disabled={!storefront} />
                    <ThemeMenu
                      theme={t}
                      onRename={() => open('rename', t)}
                      onDuplicate={() => duplicate.mutate({ id: t.id })}
                      onCopySettings={() => copySettings(t)}
                      onDelete={() => open('delete', t)}
                    />
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>

          {available.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Add a theme</CardTitle>
                <CardDescription>
                  Included with your storefront. A new copy starts from the theme’s defaults, whatever you already have.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ul className="divide-y">
                  {available.map((d) => (
                    <li key={d.id} className="flex flex-wrap items-center gap-3 py-3 first:pt-0 last:pb-0">
                      <Screenshot url={d.screenshot} />
                      <div className="mr-auto min-w-0">
                        <p className="truncate font-medium">{d.name}</p>
                        {copiesOf(d.id) > 0 && (
                          <p className="text-sm text-muted-foreground">
                            You have {copiesOf(d.id)} {copiesOf(d.id) === 1 ? 'copy' : 'copies'}
                          </p>
                        )}
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={add.isPending}
                        onClick={() =>
                          add.mutate({ themeId: d.id, name: nameForNewCopy(d.name), document: d.defaults })
                        }
                      >
                        <PlusIcon />
                        Add
                      </Button>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}

          {styles.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Theme Store</CardTitle>
                <CardDescription>
                  Styles from the marketplace for the themes your storefront includes. Adding one gives you a copy to
                  customize; it doesn’t change your store until you use it.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ul className="divide-y">
                  {styles.map((style) => (
                    <li key={style.id} className="flex flex-wrap items-center gap-3 py-3 first:pt-0 last:pb-0">
                      <Screenshot url={style.screenshotUrl} />
                      <div className="mr-auto min-w-0 flex-1">
                        <p className="flex items-center gap-2 font-medium">
                          <span className="truncate">{style.name}</span>
                          {data?.some((t) => t.marketplaceThemeId === style.id) && (
                            <Badge variant="secondary">Added</Badge>
                          )}
                        </p>
                        <p className="text-sm text-muted-foreground">
                          {baseName(style.baseThemeId)} style · by {style.developerName}
                        </p>
                        <p className="line-clamp-2 text-sm text-muted-foreground">{style.tagline}</p>
                      </div>
                      <Button
                        size="sm"
                        variant="ghost"
                        nativeButton={false}
                        render={<a href={style.listingUrl} target="_blank" rel="noopener" />}
                      >
                        Details
                        <ExternalLinkIcon />
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={!storefront || addFromStore.isPending}
                        title={storefront ? undefined : 'Your storefront can’t be reached'}
                        onClick={() => addFromStore.mutate({ id: style.id })}
                      >
                        <PlusIcon />
                        Add
                      </Button>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}

          {others.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Other themes</CardTitle>
                <CardDescription>
                  Your storefront doesn’t include these themes, so they can’t be used. Their customizations are kept.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ul className="divide-y">
                  {others.map((t) => (
                    <li key={t.id} className="flex flex-wrap items-center gap-3 py-3 first:pt-0 last:pb-0">
                      <div className="mr-auto min-w-0">
                        <p className="truncate font-medium">{t.name}</p>
                        <p className="text-sm text-muted-foreground">Edited {formatDate(t.updatedAt)}</p>
                      </div>
                      <ThemeMenu theme={t} onRename={() => open('rename', t)} onDelete={() => open('delete', t)} />
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}
        </>
      )}

      {dialogs}
    </div>
  )
}

// Tokens last an hour; renew well before that
const TOKEN_REFRESH_MS = 45 * 60 * 1000

// The theme's screenshot, or else the copy's draft on the storefront (the editor's preview, scaled down); opens the editor
function ThemeThumbnail({
  storefrontUrl,
  theme,
  screenshot,
}: {
  storefrontUrl: string
  theme: Theme
  screenshot?: string | null
}) {
  const { data } = useQuery({
    ...orpc.admin.themes.previewToken.queryOptions({ input: { id: theme.id } }),
    enabled: !screenshot,
    staleTime: TOKEN_REFRESH_MS,
    refetchInterval: TOKEN_REFRESH_MS,
  })
  let url: string | null = null
  if (data) {
    const u = new URL(storefrontUrl)
    u.searchParams.set(THEME_PREVIEW_PARAM, data.token)
    url = u.toString()
  }
  return <StorefrontThumbnail url={url} themeId={theme.id} screenshot={screenshot} />
}

function CustomizeButton({ theme, disabled }: { theme: Theme; disabled: boolean }) {
  if (disabled) {
    return (
      <Button size="sm" variant="outline" disabled title="Your storefront can’t be reached">
        Customize
      </Button>
    )
  }
  return (
    <Button
      size="sm"
      variant="outline"
      nativeButton={false}
      render={<Link to="/admin/online-store/editor/$id" params={{ id: theme.id }} />}
    >
      Customize
    </Button>
  )
}

// A picture of a theme or style, not linked to anything (the theme's own, or a marketplace style's, hosted anywhere)
function Screenshot({ url }: { url: string | null }) {
  return (
    <div className="aspect-[16/10] w-40 shrink-0 overflow-hidden rounded-md border bg-muted">
      {url ? (
        <img src={url} alt="" loading="lazy" className="h-full w-full object-cover object-top" />
      ) : (
        <div className="flex h-full items-center justify-center text-xs text-muted-foreground">No preview</div>
      )}
    </div>
  )
}

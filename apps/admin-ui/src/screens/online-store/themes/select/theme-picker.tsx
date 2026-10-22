'use client'

// Online store → Themes → Change theme: every theme in the shop. Copies of the themes the storefront includes
// can be customized and used (published); copies of others wait for a storefront with their theme. The
// storefront's themes without a copy yet can be added. Marketplace themes will be listed here too.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { THEME_PREVIEW_PARAM } from '@shopnex/storefront-sdk/theme-preview'
import {
  ClipboardCopyIcon,
  CodeIcon,
  CopyIcon,
  EllipsisIcon,
  ExternalLinkIcon,
  PencilIcon,
  PlusIcon,
  Trash2Icon,
  TriangleAlertIcon,
} from 'lucide-react'
import { Link, useNavigate } from '@tanstack/react-router'
import { toast } from 'sonner'
import { PageHeader } from '@/components/admin/page-header'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Skeleton } from '@/components/ui/skeleton'
import { formatDate } from '@/lib/format'
import { client, orpc, type Outputs } from '@/lib/orpc'
import type { Storefront } from '../definition'
import { StorefrontThumbnail } from '../storefront-thumbnail'
import { useThemeDialogs, type Theme } from '../theme-dialogs'

type Props = {
  /** The storefront's themes; null when it can't be reached */
  storefront: Storefront | null
  storefrontError: React.ReactNode
}

export function ThemePicker({ storefront, storefrontError }: Props) {
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
    orpc.admin.themes.ensure.mutationOptions({
      onSuccess: (copy) => {
        if (copy) toast.success(`Added ${copy.name}`)
        return queryClient.invalidateQueries({ queryKey: orpc.admin.themes.key() })
      },
      onError: (e) => toast.error(e.message),
    }),
  )

  // While the storefront can't be reached, every theme counts as included
  const themeOf = (t: Theme) => storefront?.themes.find((d) => d.id === t.themeId)
  const ours = data?.filter((t) => !storefront || themeOf(t)) ?? []
  const others = data?.filter((t) => storefront && !themeOf(t)) ?? []
  const available = storefront?.themes.filter((d) => !data?.some((t) => t.themeId === d.id)) ?? []
  const current = ours.find((t) => t.role === 'live')
  // Styles for themes the storefront includes (all of them while it can't be reached, to show what's there)
  const styles = store.data?.filter((s) => !storefront || storefront.themes.some((d) => d.id === s.baseThemeId)) ?? []
  const baseName = (id: string) => storefront?.themes.find((d) => d.id === id)?.name ?? id

  return (
    <div className="space-y-4">
      <PageHeader
        title="Change theme"
        description="Choose the theme buyers see. Work on a copy without touching your store, then use it when it’s ready."
        back={{ to: '/admin/online-store/themes', label: 'Themes' }}
        actions={
          storefront &&
          current && (
            <Button size="sm" disabled={duplicate.isPending} onClick={() => duplicate.mutate({ id: current.id })}>
              <PlusIcon />
              Copy current theme
            </Button>
          )
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
        <Skeleton className="h-40 w-full" />
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Your themes</CardTitle>
              <CardDescription>Customize one without touching your store, then use it when it’s ready</CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="divide-y">
                {ours.map((t) => (
                  <li key={t.id} className="flex flex-wrap items-center gap-3 py-3 first:pt-0 last:pb-0">
                    <div className="w-40 shrink-0">
                      {storefront && themeOf(t) ? (
                        <ThemeThumbnail storefrontUrl={storefront.url} theme={t} />
                      ) : (
                        <div className="flex aspect-[16/10] items-center justify-center rounded-md border bg-muted text-xs text-muted-foreground">
                          No preview
                        </div>
                      )}
                    </div>
                    <div className="mr-auto min-w-0">
                      <p className="flex items-center gap-2 font-medium">
                        <span className="truncate">{t.name}</span>
                        {t.role === 'live' && <Badge variant="secondary">Current</Badge>}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {themeOf(t) && themeOf(t)!.name !== t.name && `${themeOf(t)!.name} theme · `}
                        Edited {formatDate(t.updatedAt)}
                      </p>
                    </div>
                    {t.role !== 'live' && (
                      <Button variant="outline" size="sm" disabled={!storefront} onClick={() => open('publish', t)}>
                        Use theme
                      </Button>
                    )}
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
                <CardDescription>Included with your storefront</CardDescription>
              </CardHeader>
              <CardContent>
                <ul className="divide-y">
                  {available.map((d) => (
                    <li key={d.id} className="flex flex-wrap items-center gap-3 py-3 first:pt-0 last:pb-0">
                      <p className="mr-auto truncate font-medium">{d.name}</p>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={add.isPending}
                        onClick={() => add.mutate({ themeId: d.id, name: d.name, document: d.defaults })}
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
                      <StyleScreenshot style={style} />
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

// The copy's draft on the storefront (the editor's preview, scaled down); opens the editor
function ThemeThumbnail({ storefrontUrl, theme }: { storefrontUrl: string; theme: Theme }) {
  const { data } = useQuery({
    ...orpc.admin.themes.previewToken.queryOptions({ input: { id: theme.id } }),
    staleTime: TOKEN_REFRESH_MS,
    refetchInterval: TOKEN_REFRESH_MS,
  })
  let url: string | null = null
  if (data) {
    const u = new URL(storefrontUrl)
    u.searchParams.set(THEME_PREVIEW_PARAM, data.token)
    url = u.toString()
  }
  return <StorefrontThumbnail url={url} themeId={theme.id} />
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
      render={<Link to="/admin/online-store/themes/$id" params={{ id: theme.id }} />}
    >
      Customize
    </Button>
  )
}

type StoreStyle = Outputs['admin']['themes']['store'][number]

function StyleScreenshot({ style }: { style: StoreStyle }) {
  return (
    <div className="aspect-[16/10] w-40 shrink-0 overflow-hidden rounded-md border bg-muted">
      {style.screenshotUrl ? (
        // Vendor-hosted, any domain
        <img src={style.screenshotUrl} alt="" loading="lazy" className="h-full w-full object-cover object-top" />
      ) : (
        <div className="flex h-full items-center justify-center text-xs text-muted-foreground">No preview</div>
      )}
    </div>
  )
}

// The copy's draft as JSON: what a theme style on the marketplace is made of
async function copySettings(theme: Theme) {
  try {
    const { draft } = await client.admin.themes.get({ id: theme.id })
    await navigator.clipboard.writeText(JSON.stringify(draft, null, 2))
    toast.success(`Copied ${theme.name}’s settings`, {
      description: `To sell it as a style for ${theme.themeId} on the marketplace, paste them in a new theme style.`,
    })
  } catch (e) {
    toast.error(e instanceof Error ? e.message : 'Couldn’t copy the settings')
  }
}

type MenuProps = {
  theme: Theme
  onRename: () => void
  onDuplicate?: () => void
  onCopySettings?: () => void
  onDelete: () => void
}

// A live copy can't be deleted: its storefront shows it
function ThemeMenu({ theme, onRename, onDuplicate, onCopySettings, onDelete }: MenuProps) {
  const navigate = useNavigate()
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label="More actions" />}>
        <EllipsisIcon />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuItem onClick={onRename}>
          <PencilIcon />
          Rename
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => navigate({ to: '/admin/online-store/themes/$id/code', params: { id: theme.id } })}
        >
          <CodeIcon />
          Edit code
        </DropdownMenuItem>
        {onDuplicate && (
          <DropdownMenuItem onClick={onDuplicate}>
            <CopyIcon />
            Duplicate
          </DropdownMenuItem>
        )}
        {onCopySettings && (
          <DropdownMenuItem onClick={onCopySettings}>
            <ClipboardCopyIcon />
            Copy settings
          </DropdownMenuItem>
        )}
        {theme.role !== 'live' && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onClick={onDelete}>
              <Trash2Icon />
              Delete
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

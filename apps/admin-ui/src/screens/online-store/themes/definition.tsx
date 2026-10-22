import { Link } from '@tanstack/react-router'
import { THEME_DEFINITION_PATH, parseThemeManifest, type ThemeDocument } from '@shopnex/storefront-sdk/theme'
import { PageHeader } from '@/components/admin/page-header'
import { Card, CardContent } from '@/components/ui/card'

// The storefront describes its themes at THEME_DEFINITION_PATH; read it on every visit so a redeployed
// storefront's new themes and sections show up right away.
export async function fetchThemes(storefrontUrl: string | null) {
  if (!storefrontUrl) return { error: <NoStorefront /> }
  const url = new URL(THEME_DEFINITION_PATH, storefrontUrl)
  try {
    const res = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(5000) })
    if (!res.ok) return { error: `${url} answered ${res.status}` }
    const parsed = parseThemeManifest(await res.json())
    if (!parsed.success) return { error: `${url} isn't a valid theme manifest: ${parsed.error.issues[0]?.message}` }
    return { themes: parsed.themes }
  } catch {
    return { error: `Could not reach ${url}. Is the storefront running?` }
  }
}

/** The themes the storefront includes, the first being its default; `defaults` starts a new copy */
export type Storefront = { url: string; themes: { id: string; name: string; defaults: ThemeDocument }[] }

function NoStorefront() {
  return (
    <>
      Set your <strong>Storefront URL</strong> under{' '}
      <Link to="/admin/settings/general" className="underline">
        Settings
      </Link>{' '}
      (for local development: http://localhost:4321). Themes are shown on your storefront and read their options from
      there.
    </>
  )
}

export function ThemesProblem({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader title="Themes" description="How your online store looks" />
      <Card>
        <CardContent className="text-sm text-muted-foreground">{children}</CardContent>
      </Card>
    </div>
  )
}

import { createServerFn } from '@tanstack/react-start'
import {
  THEME_DEFINITION_PATH,
  defaultDocument,
  parseThemeManifest,
  type ThemeDefinition,
  type ThemeDocument,
} from '@shopnex/storefront-sdk/theme'
import { serverClient } from '@/lib/orpc.server'
import type { PreviewCatalog } from './preview-pages'

export type Storefront = {
  url: string
  themes: { id: string; name: string; defaults: ThemeDocument; definition: ThemeDefinition }[]
}
export type StorefrontResult = { storefront: Storefront | null; storefrontError: string | null }
async function loadPreviewCatalog(storefrontUrl: string | null): Promise<PreviewCatalog> {
  if (!storefrontUrl) return { products: [], collections: [], pages: [] }
  try {
    const response = await fetch(new URL('/shopnex/preview-pages.json', storefrontUrl), {
      cache: 'no-store',
      signal: AbortSignal.timeout(5000),
    })
    if (response.ok) return (await response.json()) as PreviewCatalog
  } catch {
    // The editor can still preview standard storefront routes without catalog data.
  }
  return { products: [], collections: [], pages: [] }
}

export const loadStorefront = createServerFn({ method: 'GET' })
  .validator((storefrontUrl: string | null) => storefrontUrl)
  .handler(async ({ data: storefrontUrl }): Promise<StorefrontResult> => {
    if (!storefrontUrl)
      return {
        storefront: null,
        storefrontError: 'Set your Storefront URL under Settings, or STOREFRONT_URL in .env.',
      }
    const url = new URL(THEME_DEFINITION_PATH, storefrontUrl)
    let themes
    try {
      const response = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(5000) })
      if (!response.ok) return { storefront: null, storefrontError: `${url} answered ${response.status}` }
      const parsed = parseThemeManifest(await response.json())
      if (!parsed.success)
        return {
          storefront: null,
          storefrontError: `${url} isn't a valid theme manifest: ${parsed.error.issues[0]?.message}`,
        }
      themes = parsed.themes
    } catch {
      return { storefront: null, storefrontError: `Could not reach ${url}. Is the storefront running?` }
    }
    const documents = themes.map((definition) => ({
      id: definition.id,
      name: definition.name,
      defaults: defaultDocument(definition),
      definition,
    }))
    const first = documents[0]
    if (first) await serverClient.admin.themes.ensure({ themeId: first.id, name: first.name, document: first.defaults })
    return { storefront: { url: storefrontUrl, themes: documents }, storefrontError: null }
  })

export const loadThemeEditor = createServerFn({ method: 'GET' })
  .validator((input: { id: string; storefrontUrl: string | null }) => input)
  .handler(async ({ data }) => {
    const theme = await serverClient.admin.themes.get({ id: data.id })
    const storefront = await loadStorefront({ data: data.storefrontUrl })
    const definition = storefront.storefront?.themes.find((item) => item.id === theme.themeId)?.definition
    const previewCatalog = await loadPreviewCatalog(storefront.storefront?.url ?? null)
    return { theme, storefront, definition: definition ?? null, previewCatalog }
  })

export const loadThemeCode = createServerFn({ method: 'GET' })
  .validator((input: { id: string; storefrontUrl: string | null }) => input)
  .handler(async ({ data }) => {
    const { draft, published: __, ...theme } = await serverClient.admin.themes.get({ id: data.id })
    const { storefront } = await loadStorefront({ data: data.storefrontUrl })
    const definition = storefront?.themes.find((item) => item.id === theme.themeId)?.definition
    const previewCatalog = await loadPreviewCatalog(storefront?.url ?? null)
    // Which sections each page has and where it previews, so the code editor can point the preview at one
    const pageIds = new Set([...Object.keys(definition?.pages ?? {}), ...Object.keys(draft.pages)])
    const pages = [...pageIds].map((page) => ({
      path: definition?.pages[page]?.path ?? (page === 'home' ? '/' : null),
      sections: (draft.pages[page]?.sections ?? definition?.pages[page]?.sections ?? []).map((s) => ({
        id: s.id,
        type: s.type,
      })),
    }))
    return { ...theme, pages, definition: definition ?? null, previewCatalog }
  })

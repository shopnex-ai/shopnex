import { THEME_STATIC_PAGE, type ThemeDefinition } from '@shopnex/storefront-sdk/theme'

export type PreviewCatalog = {
  products: { handle: string; title: string }[]
  collections: { handle: string; title: string }[]
  pages: { handle: string; title: string }[]
}

export type PreviewPageOption = { value: string; label: string }

// What the editor calls the pages every theme has; any other page uses the name its theme gives it
const PAGE_LABELS: Record<string, string> = {
  home: 'Home page',
  collection: 'Collection',
  product: 'Product',
  page: 'Content page',
  '404': '404 page',
}

export function previewPageOptions(definition: ThemeDefinition | null, catalog: PreviewCatalog): PreviewPageOption[] {
  const pages = definition?.pages ?? {}
  const declared = Object.entries(pages)
    // The global sections are a group on every page, not a page to preview
    .filter(([value]) => value !== THEME_STATIC_PAGE)
    .map(([value, page]) => ({ value, label: PAGE_LABELS[value] ?? page.name }))
  // These are offered even when a theme does not list them
  const missing = ['collection', 'product', 'page', '404']
    .filter((value) => !pages[value])
    .map((value) => ({ value, label: PAGE_LABELS[value]! }))
  return [...declared, ...missing]
}

export function previewPagePath(page: string, definition: ThemeDefinition | null, catalog: PreviewCatalog): string {
  if (page === '404') return '/shopnex/theme-editor-404-preview'
  if (page === 'product') return catalog.products[0] ? `/products/${catalog.products[0].handle}` : '/products'
  if (page === 'collection') {
    return catalog.collections[0]
      ? `/collections/${catalog.collections[0].handle}`
      : (definition?.pages[page]?.path ?? '/products')
  }
  if (page === 'page') return catalog.pages[0] ? `/pages/${catalog.pages[0].handle}` : '/'

  const declaredPath = definition?.pages[page]?.path
  if (declaredPath) return declaredPath
  return '/'
}

export function templatePreviewPage(file: string): string | null {
  if (!file.startsWith('templates/')) return null
  const template = file.slice('templates/'.length).replace(/\.liquid$/, '')
  if (template === 'index') return 'home'
  return ['404', 'product', 'collection', 'page'].includes(template) ? template : null
}

export function previewPageForPath(path: string, definition: ThemeDefinition | null, catalog: PreviewCatalog): string {
  if (path === '/shopnex/theme-editor-404-preview') return '404'
  const declared = Object.entries(definition?.pages ?? {}).find(([, page]) => page.path === path)
  if (declared) return declared[0]
  if (catalog.products.some((item) => path === `/products/${item.handle}`)) return 'product'
  if (catalog.collections.some((item) => path === `/collections/${item.handle}`)) return 'collection'
  if (catalog.pages.some((item) => path === `/pages/${item.handle}`)) return 'page'
  if (path === '/products') return 'collection'
  return 'home'
}

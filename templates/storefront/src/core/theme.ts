// Themes and rendering. A theme is a folder in themes/ (SHOPNEX_THEMES_DIR) with Liquid templates, no code
// that runs on the server:
//
//   theme.json             its ThemeDefinition (settings, sections, default pages, styles)
//   layout/theme.liquid    every page: {{ content_for_header }} in <head>, {{ content_for_layout }} in <body>
//   templates/             index, collection, product, page, 404 (.liquid)
//   sections/{type}.liquid one per section type in theme.json; `{% sections 'home' %}` renders a page's
//   snippets/              for {% render %}
//   assets/                served at /shopnex/assets/{theme}/…; `{{ 'theme.css' | asset_url }}`
//
// themes/index.json lists the themes; the first is the default. Each request asks Shopnex which theme is live
// (`storefront.theme.current`) and renders its template for the route with the merchant's settings; in the
// theme editor's preview (?shopnex_preview=token) the draft instead. Falls back to the default theme (with its
// defaults) when the live theme isn't one of ours or Shopnex can't be reached. Files the merchant edited
// (Edit code) replace the theme's own: they're loaded with `storefront.theme.files` when their version changes.
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { Context, type Liquid } from 'liquidjs'
import {
  THEME_PREVIEW_PARAM,
  ThemeDefinition,
  defaultDocument,
  resolveSettings,
  type Collection,
  type Page,
  type PageInfo,
  type Product,
  type ThemeDocument,
  type ThemeSection,
  type ThemeSettings,
} from '@shopnex/storefront-sdk'
import { catalogHref, sortOptions } from './catalog'
import {
  CollectionDrop,
  Lazy,
  LinklistsDrop,
  Loader,
  ProductDrop,
  SafeHtml,
  collectionsObject,
  pageObject,
  settingsObject,
  shopObject,
} from './drops'
import { RENDER, createLiquid, type RenderData } from './liquid'
import { seoTags } from './seo'
import { browserConfig, shopnex } from './shopnex'

const dev = import.meta.env.DEV

export const THEMES_DIR = resolve(process.env.SHOPNEX_THEMES_DIR ?? 'themes')

export const TEMPLATES = ['index', 'collection', 'product', 'page', '404'] as const
export type TemplateName = (typeof TEMPLATES)[number]

export interface Theme {
  id: string
  /** The theme's folder */
  dir: string
  definition: ThemeDefinition
  liquid: Liquid
}

function readTheme(id: string): Theme {
  const dir = join(THEMES_DIR, id)
  const file = join(dir, 'theme.json')
  const parsed = ThemeDefinition.safeParse(JSON.parse(readFileSync(file, 'utf8')))
  if (!parsed.success) throw new Error(`[theme] ${file} is not a valid theme definition: ${parsed.error.message}`)
  const definition = parsed.data
  if (definition.id !== id) throw new Error(`[theme] ${file}: the id is "${definition.id}", the folder "${id}"`)
  const missing = [
    'layout/theme',
    ...TEMPLATES.map((t) => `templates/${t}`),
    ...Object.keys(definition.sections).map((s) => `sections/${s}`),
  ].filter((f) => !existsSync(join(dir, `${f}.liquid`)))
  if (missing.length) throw new Error(`[theme] ${id} is missing ${missing.map((f) => `${f}.liquid`).join(', ')}`)
  return { id, dir, definition, liquid: createLiquid(id, dir) }
}

function readThemes(): Theme[] {
  const index = JSON.parse(readFileSync(join(THEMES_DIR, 'index.json'), 'utf8')) as { themes: string[] }
  if (!index.themes?.length) throw new Error(`[theme] ${THEMES_DIR}/index.json lists no themes`)
  return index.themes.map(readTheme)
}

let cached: Theme[] | undefined
/** The storefront's themes; the first is the default. Read once (in dev on every request, so edits show). */
export function themes(): Theme[] {
  if (dev) return readThemes()
  return (cached ??= readThemes())
}

export const findTheme = (id: string) => themes().find((t) => t.id === id)

// Engines for copies with edited files, by copy and files version (a save makes a new one). Small: a shop
// renders its live copy, plus the copy in the editor's preview.
const MAX_EDITED = 20
const edited = new Map<string, Promise<Liquid>>()

function editedLiquid(theme: Theme, files: { copyId: string; version: number }, previewToken?: string) {
  const key = `${theme.id}:${files.copyId}:${files.version}`
  let liquid = edited.get(key)
  if (!liquid) {
    liquid = shopnex.theme.files({ previewToken }).then((loaded) => createLiquid(theme.id, theme.dir, loaded.files))
    // A failed load is retried on the next request
    liquid.catch(() => edited.delete(key))
    edited.set(key, liquid)
    if (edited.size > MAX_EDITED) edited.delete(edited.keys().next().value!)
  }
  return liquid
}

export interface LoadedTheme {
  theme: Theme
  /** The theme's engine, with the merchant's edited files when there are some */
  liquid: Liquid
  /** Global settings, every field resolved (defaults applied) */
  settings: ThemeSettings
  /** True inside the editor's preview: the draft is shown and the page listens to the editor */
  preview: boolean
  /** A page's visible sections, known types only, settings resolved */
  sections(page: string): ThemeSection[]
}

export async function loadTheme(url: URL): Promise<LoadedTheme> {
  const previewToken = url.searchParams.get(THEME_PREVIEW_PARAM) ?? undefined
  let current: {
    themeId: string | null
    document: ThemeDocument | null
    preview: boolean
    files: { copyId: string; version: number } | null
  } = { themeId: null, document: null, preview: false, files: null }
  try {
    current = await shopnex.theme.current({ previewToken })
  } catch (error) {
    // The store keeps working on the default theme if Shopnex is unreachable
    console.error('[theme] could not load the shop’s theme:', error)
  }
  const all = themes()
  const found = current.themeId ? all.find((t) => t.id === current.themeId) : undefined
  const theme = found ?? all[0]!
  const { definition } = theme
  const defaults = defaultDocument(definition)
  const document = (found && current.document) || defaults
  let liquid = theme.liquid
  if (found && current.files) {
    try {
      liquid = await editedLiquid(theme, current.files, previewToken)
    } catch (error) {
      console.error('[theme] could not load the shop’s edited theme files:', error)
    }
  }

  return {
    theme,
    liquid,
    settings: resolveSettings(definition.settings, document.settings),
    preview: !!found && current.preview,
    sections(page) {
      const sections = document.pages[page]?.sections ?? defaults.pages[page]?.sections ?? []
      return sections.flatMap((s) => {
        const section = definition.sections[s.type]
        if (!section || s.disabled) return []
        return [{ ...s, settings: resolveSettings(section.settings, s.settings) }]
      })
    },
  }
}

/** What a route renders: a template and its objects */
export type ThemePage =
  | { template: 'index' }
  | {
      template: 'collection'
      /** null: all products (/products) */
      collection: Collection | null
      products: Product[]
      pageInfo: PageInfo
      /** Slug of the sort option in use (see core/catalog), null for the default */
      sort: string | null
    }
  | { template: 'product'; product: Product }
  | { template: 'page'; page: Page }
  | { template: '404' }

type PageMeta = { title: string | null; description: string | null; image: string | null }

function templateObjects(page: ThemePage, url: URL, loader: Loader): [Record<string, unknown>, PageMeta] {
  switch (page.template) {
    case 'collection': {
      const { collection } = page
      const paged = url.searchParams.has('after')
      const drop = new CollectionDrop(collection, loader, {
        products: page.products,
        sort_by: page.sort ?? '',
        sort_options: sortOptions.map((o) => ({
          name: o.title,
          value: o.slug ?? '',
          url: catalogHref(url, { sort: o.slug, after: null }),
          selected: o.slug === page.sort,
        })),
      })
      const paginate = {
        next:
          page.pageInfo.hasNextPage && page.pageInfo.endCursor
            ? { url: catalogHref(url, { after: page.pageInfo.endCursor }) }
            : null,
        /** Back to the first page (paging is forward-only) */
        first: paged ? { url: catalogHref(url, { after: null }) } : null,
      }
      return [
        { collection: drop, paginate },
        {
          title: collection?.title ?? 'All products',
          description: collection ? (collection.seo.description ?? collection.description) || null : null,
          image: collection?.image?.url ?? null,
        },
      ]
    }
    case 'product': {
      const { product } = page
      const drop = new ProductDrop(product, url.searchParams.get('variant'))
      // Shopify's product recommendations: others from the product's first collection
      const first = product.collectionHandles[0]
      const recommendations = {
        products: first
          ? new Lazy(() =>
              loader.products(first).then((all) =>
                all
                  .filter((p) => p.id !== product.id)
                  .slice(0, 4)
                  .map((p) => new ProductDrop(p)),
              ),
            )
          : [],
      }
      return [
        { product: drop, recommendations },
        {
          title: product.seo.title ?? product.title,
          description: product.seo.description ?? product.description.slice(0, 160),
          image: product.featuredImage?.url ?? null,
        },
      ]
    }
    case 'page':
      return [
        { page: pageObject(page.page) },
        {
          title: page.page.seo.title ?? page.page.title,
          description: page.page.seo.description ?? page.page.bodySummary,
          image: null,
        },
      ]
    default:
      return [{}, { title: null, description: null, image: null }]
  }
}

const adminOrigin = new URL(import.meta.env.SHOPNEX_URL ?? 'http://localhost:3000').origin

/**
 * What the storefront adds to every page's head: Storefront API settings for theme scripts, the preview, and
 * the page's SEO tags (core/seo)
 */
function contentForHeader(preview: boolean, seo: string[] = []) {
  const attr = (value: string) => value.replace(/&/g, '&amp;').replace(/"/g, '&quot;')
  return [
    `<meta name="shopnex-url" content="${attr(browserConfig.baseUrl)}">`,
    browserConfig.publishableKey && `<meta name="shopnex-key" content="${attr(browserConfig.publishableKey)}">`,
    // In the theme editor's preview iframe: reload after a save, highlight the picked section
    preview && `<meta name="shopnex-admin-origin" content="${attr(adminOrigin)}">`,
    preview && `<script type="module" src="/shopnex/preview.js"></script>`,
    ...seo,
  ]
    .filter(Boolean)
    .join('\n')
}

/**
 * Renders a page with the theme: the template, then layout/theme.liquid around it. Both share one scope, so
 * a template can `{% assign page_title = … %}` for the layout.
 */
export async function render(loaded: LoadedTheme, url: URL, page: ThemePage): Promise<Response> {
  try {
    return await renderPage(loaded, url, page)
  } catch (error) {
    if (!loaded.preview) throw error
    // In the editor's preview, show what broke (likely an edited file) instead of an error page
    console.error('[theme] render failed:', error)
    // Paths relative to the theme ("snippets/x.liquid"), not the server's folders
    const message = (error instanceof Error ? error.message : String(error)).replaceAll(`file:${loaded.theme.dir}/`, '')
    const escaped = message.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!)
    return new Response(
      `<!doctype html><meta charset="utf-8"><title>Liquid error</title>${contentForHeader(true)}` +
        `<body style="font:14px/1.5 system-ui;padding:2rem;color:#7f1d1d">` +
        `<h1 style="font-size:1rem">This page can’t be shown</h1><pre style="white-space:pre-wrap">${escaped}</pre>`,
      { status: 500, headers: { 'content-type': 'text/html; charset=utf-8' } },
    )
  }
}

async function renderPage(loaded: LoadedTheme, url: URL, page: ThemePage): Promise<Response> {
  const { theme, liquid } = loaded
  const loader = new Loader(url)
  const shop = await loader.shop()
  const [objects, meta] = templateObjects(page, url, loader)
  // The homepage's title and description are the shop's (Settings → General)
  if (page.template === 'index' && shop) Object.assign(meta, shop.seo)

  const renderData: RenderData = {
    sections: (pageId) =>
      loaded.sections(pageId).map((s) => ({
        id: s.id,
        type: s.type,
        settings: settingsObject(theme.definition.sections[s.type]!.settings, s.settings, loader),
      })),
  }
  const globals = {
    shop: shopObject(shop),
    settings: settingsObject(theme.definition.settings, loaded.settings, loader),
    collections: collectionsObject(loader),
    linklists: new LinklistsDrop(loader),
    request: { path: url.pathname, origin: url.origin, page_type: page.template, design_mode: loaded.preview },
    template: { name: page.template },
    theme: { id: theme.id, name: theme.definition.name, version: theme.definition.version ?? null },
    content_for_header: new SafeHtml(contentForHeader(loaded.preview, seoTags(page, url, shop, loaded.preview))),
    [RENDER]: renderData,
  }

  const scope = { ...objects, page_title: meta.title, page_description: meta.description, page_image: meta.image }
  const context = new Context(scope, liquid.options, { globals })
  const content = await liquid.renderFile(`templates/${page.template}`, context)
  context.push({ content_for_layout: new SafeHtml(content) })
  const html = await liquid.renderFile('layout/theme', context)

  return new Response(html, {
    status: page.template === '404' ? 404 : 200,
    headers: { 'content-type': 'text/html; charset=utf-8' },
  })
}

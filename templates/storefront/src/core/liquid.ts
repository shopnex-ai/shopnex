// The Liquid engine themes render with (LiquidJS). Safe for templates from third parties: no JavaScript runs,
// files are read only from the theme's folder, rendering is time- and memory-limited.
//
// Differences from Shopify's Liquid a theme developer should know:
//   - Output is HTML-escaped: `{{ product.title }}` is safe anywhere. HTML from the admin (product.description,
//     collection.description, page.content, `code` settings) and content_for_* output as is; `| raw` outputs
//     anything else unescaped (e.g. `{{ data | json | raw }}` inside <script>; `json` escapes `<`).
//   - `{% capture %}` keeps its (already escaped) output as is: `{{ captured }}` doesn't escape it again.
//   - Prices are objects (`| money` formats them with their own currency) that compare as minor units.
//   - `{% sections 'home' %}` renders a page's sections from the theme editor (see `sections` below).
import { dirname, extname, join, resolve, sep } from 'node:path'
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import {
  CaptureTag as LiquidCaptureTag,
  Liquid,
  Tag,
  type Context,
  type Emitter,
  type FS,
  type TagToken,
  type TopLevelToken,
  type Template,
} from 'liquidjs'
import { formatMoney, moneyAmount } from '@shopnex/storefront-sdk/money'
import { THEME_SECTION_ATTRIBUTE } from '@shopnex/storefront-sdk/theme-preview'
import { ImageDrop, MoneyDrop, SafeHtml } from './drops'

/** A section as templates see it (`section.id`, `section.type`, `section.settings`) */
export type SectionObject = { id: string; type: string; settings: Record<string, unknown> }

/** Per-render data for tags and filters, under a symbol key of the globals (templates can't read it) */
export const RENDER = Symbol('render')
export interface RenderData {
  /** The page's sections by page id; `{% sections 'home' %}` renders them */
  sections(page: string): SectionObject[]
}

const dev = import.meta.env.DEV

const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&#34;', "'": '&#39;' })[c]!)

const unescapes: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#34;': '"',
  '&#39;': "'",
}

const text = (value: unknown): string =>
  value == null ? '' : String(value instanceof Object ? value.valueOf() : value)

function renderData(context: Context): RenderData {
  return (context.globals as Record<symbol, RenderData>)[RENDER]!
}

// Cache-busting for asset_url: the file's modification time (looked up once per file in production)
const versions = new Map<string, string>()
function assetVersion(file: string) {
  let version = dev ? undefined : versions.get(file)
  if (version === undefined) {
    try {
      version = Math.floor(statSync(file).mtimeMs).toString(36)
    } catch {
      version = ''
    }
    versions.set(file, version)
  }
  return version
}

/** Where a theme's assets are served (stable: image settings may store these URLs) */
export const assetPath = (themeId: string, file: string) =>
  `/shopnex/assets/${encodeURIComponent(themeId)}/${file.split('/').map(encodeURIComponent).join('/')}`

/**
 * The theme's folder, with the merchant's edited files (Edit code: path in the theme → source) read instead
 * of the ones on disk. Lookups stay inside the folders LiquidJS is given; there's no fallback to node_modules.
 */
function themeFs(dir: string, files: Record<string, string>): FS {
  const edited = new Map(Object.entries(files).map(([path, source]) => [join(dir, path), source]))
  const inside = (root: string, file: string) => file.startsWith(root.endsWith(sep) ? root : root + sep)
  const containsSync = (root: string, file: string) => {
    if (edited.has(file)) return inside(resolve(root), file)
    try {
      return inside(realpathSync(root), realpathSync(file))
    } catch {
      return false
    }
  }
  return {
    existsSync: (file) => edited.has(file) || existsSync(file),
    exists: async (file) => edited.has(file) || existsSync(file),
    readFileSync: (file) => edited.get(file) ?? readFileSync(file, 'utf8'),
    readFile: async (file) => edited.get(file) ?? readFile(file, 'utf8'),
    resolve: (root, file, ext) => resolve(root, extname(file) ? file : file + ext),
    containsSync,
    contains: async (root, file) => containsSync(root, file),
    dirname,
    sep,
  }
}

export function createLiquid(themeId: string, dir: string, files: Record<string, string> = {}) {
  const liquid = new Liquid({
    fs: themeFs(dir, files),
    root: [dir],
    partials: [join(dir, 'snippets')],
    layouts: [join(dir, 'layout')],
    extname: '.liquid',
    cache: !dev,
    strictFilters: true,
    // Shopify's {% render %} looks names up in snippets only
    relativeReference: false,
    // HTML-escape every output, except SafeHtml (admin HTML, content_for_*) and filters marked raw
    outputEscape: (value: unknown) => (value instanceof SafeHtml ? value.toString() : escapeHtml(text(value))),
    parseLimit: 1e6,
    renderLimit: 5_000,
    memoryLimit: 1e8,
  })

  // `escape` is a no-op on top of the automatic escaping instead of escaping twice
  const escape = { handler: (value: unknown) => escapeHtml(text(value)), raw: true }
  liquid.registerFilter('escape', escape)
  liquid.registerFilter('h', escape)
  liquid.registerFilter('escape_once', {
    handler: (value: unknown) => escapeHtml(text(value).replace(/&(amp|lt|gt|quot|#34|#39);/g, (e) => unescapes[e]!)),
    raw: true,
  })

  // JSON safe inside <script> once output raw: `<`, `>` and `&` become \u escapes
  liquid.registerFilter('json', (value: unknown, space?: number) =>
    (JSON.stringify(value ?? null, null, space) ?? 'null').replace(
      /[<>&]/g,
      (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`,
    ),
  )

  liquid.registerFilter('money', function (this: { context: Context }, value: unknown) {
    const amount = MoneyDrop.unwrap(value)
    if (amount) return formatMoney(amount)
    // A plain number (minor units) is in the shop's currency
    const currency = this.context.getSync(['shop', 'currency'])
    if (typeof value === 'number' && typeof currency === 'string')
      return formatMoney({ amountMinor: value, currencyCode: currency })
    return ''
  })
  liquid.registerFilter('money_with_currency', (value: unknown) => {
    const amount = MoneyDrop.unwrap(value)
    return amount ? `${formatMoney(amount)} ${amount.currencyCode}` : ''
  })
  /** "19.99" (structured data, forms) */
  liquid.registerFilter('money_without_currency', (value: unknown) => {
    const amount = MoneyDrop.unwrap(value)
    return amount ? moneyAmount(amount) : ''
  })

  liquid.registerFilter('asset_url', (file: unknown) => {
    const name = text(file)
    const path = join(dir, 'assets', name)
    if (!path.startsWith(join(dir, 'assets') + sep)) return ''
    const version = assetVersion(path)
    return assetPath(themeId, name) + (version ? `?v=${version}` : '')
  })
  liquid.registerFilter('stylesheet_tag', {
    handler: (url: unknown) => `<link rel="stylesheet" href="${escapeHtml(text(url))}">`,
    raw: true,
  })
  liquid.registerFilter('script_tag', {
    handler: (url: unknown) => `<script type="module" src="${escapeHtml(text(url))}"></script>`,
    raw: true,
  })

  /** An image's (or image URL's) absolute URL. Sizes aren't generated yet: `width:` is accepted and ignored. */
  liquid.registerFilter('image_url', function (this: { context: Context }, value: unknown) {
    const src = value instanceof ImageDrop ? value.src : text(value)
    if (!src) return ''
    const origin = this.context.getSync(['request', 'origin'])
    try {
      return new URL(src, typeof origin === 'string' ? origin : undefined).href
    } catch {
      return src
    }
  })

  /** `{{ count | pluralize: 'piece', 'pieces' }}` */
  liquid.registerFilter('pluralize', (count: unknown, singular: string, plural: string) =>
    Number(text(count)) === 1 ? singular : plural,
  )

  liquid.registerFilter('handleize', (value: unknown) =>
    text(value)
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, ''),
  )

  liquid.registerTag('sections', SectionsTag)
  liquid.registerTag('capture', CaptureTag)
  return liquid
}

/** Shopify's capture, but the result is SafeHtml: it was escaped while rendering, once is enough */
class CaptureTag extends LiquidCaptureTag {
  *render(ctx: Context): Generator<unknown, void, string> {
    yield* super.render(ctx)
    const scope = ctx.bottom() as Record<string, unknown>
    scope[this.variable] = new SafeHtml(String(scope[this.variable] ?? ''))
  }
}

/**
 * `{% sections 'home' %}`: the page's sections in the merchant's order, each rendered from
 * sections/{type}.liquid with `section` (id, type, settings) and wrapped in an element with data-section-id,
 * so the theme editor's preview can highlight it.
 */
class SectionsTag extends Tag {
  private page: string

  constructor(token: TagToken, remainTokens: TopLevelToken[], liquid: Liquid) {
    super(token, remainTokens, liquid)
    const page = this.tokenizer.readValue()
    const name = page && 'content' in page ? page.content : undefined
    if (typeof name !== 'string') throw new Error(`{% sections %} needs a page id, like {% sections 'home' %}`)
    this.page = name
  }

  *render(ctx: Context, emitter: Emitter): Generator<unknown, void, unknown> {
    for (const section of renderData(ctx).sections(this.page)) {
      const templates = (yield this.liquid.parseFile(`sections/${section.type}`)) as Template[]
      emitter.write(`<div ${THEME_SECTION_ATTRIBUTE}="${escapeHtml(section.id)}">`)
      yield this.liquid.renderer.renderTemplates(templates, ctx.spawn({ section }), emitter)
      emitter.write('</div>')
    }
  }
}

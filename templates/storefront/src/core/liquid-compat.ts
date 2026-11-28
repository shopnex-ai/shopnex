// Tags and filters from Shopify's Liquid that themes written for it use, so such Liquid renders here without edits.
// Written from Shopify's public Liquid reference. Where ShopNex has no matching feature, a filter is not provided at all
// (an undefined filter is an error), because one that returns the wrong thing is worse.
import { extname, join, sep } from 'node:path'
import { readFileSync, realpathSync, statSync } from 'node:fs'
import { Liquid, Tag, type Context, type Emitter, type TagToken, type Template, type TopLevelToken } from 'liquidjs'
import { ImageDrop, SafeHtml } from './drops'
import { brightness, shiftLightness } from './color'

type Helpers = { dir: string; escapeHtml: (value: string) => string; text: (value: unknown) => string }

/** Files `inline_asset_content` will inline, and the most it inlines: icons and small styles, not data */
const INLINE_EXTENSIONS = new Set(['.svg', '.css', '.js', '.json', '.txt'])
const INLINE_MAX_BYTES = 256 * 1024

/** `name: value` arguments of a filter arrive as [name, value] pairs */
function keywords(args: unknown[]) {
  const named: Record<string, unknown> = {}
  const rest: unknown[] = []
  for (const arg of args) {
    if (Array.isArray(arg) && arg.length === 2 && typeof arg[0] === 'string') named[arg[0]] = arg[1]
    else rest.push(arg)
  }
  return { named, rest }
}

export function registerShopifyCompat(liquid: Liquid, { dir, escapeHtml, text }: Helpers) {
  // ── tags ────────────────────────────────────────────────────────────────────

  liquid.registerTag('doc', IgnoredBlockTag)
  liquid.registerTag('style', StyleTag)
  liquid.registerTag('stylesheet', makeAssetBlock('stylesheet', 'style'))
  liquid.registerTag('javascript', makeAssetBlock('javascript', 'script'))

  // ── filters ─────────────────────────────────────────────────────────────────

  // The contents of a file in the theme's assets/ (an icon to put in the page): `{{ 'icon-cart.svg' | inline_asset_content }}`
  liquid.registerFilter('inline_asset_content', {
    handler: (file: unknown) => {
      const name = text(file)
      if (!INLINE_EXTENSIONS.has(extname(name).toLowerCase())) return ''
      try {
        const root = realpathSync(join(dir, 'assets'))
        const path = realpathSync(join(root, name))
        if (!path.startsWith(root + sep) || statSync(path).size > INLINE_MAX_BYTES) return ''
        return readFileSync(path, 'utf8')
      } catch {
        return ''
      }
    },
    raw: true,
  })

  // `{{ image | image_url: width: 600 | image_tag: alt: 'Shoe', class: 'hero' }}`. Takes an image or its URL. Other keyword
  // arguments become attributes. `widths` (srcset) is accepted and ignored: image_url doesn't resize yet.
  liquid.registerFilter('image_tag', {
    handler: (value: unknown, ...args: unknown[]) => {
      const { named } = keywords(args)
      const image = value instanceof ImageDrop ? value : null
      const src = image ? image.src : text(value)
      if (!src) return ''
      const attrs: Record<string, unknown> = { src, alt: image?.alt ?? '' }
      let { width, height } = named
      const ratio = image?.aspect_ratio
      if (ratio && width && !height) height = Math.round(Number(width) / ratio)
      else if (ratio && height && !width) width = Math.round(Number(height) * ratio)
      else if (image && !width && !height) [width, height] = [image.width, image.height]
      Object.assign(attrs, named, { width, height })
      delete attrs.widths
      return `<img${attributes(attrs, escapeHtml, text)}>`
    },
    raw: true,
  })

  // `{{ 'product-1' | placeholder_svg_tag: 'my-class' }}`: a grey stand-in image (the name picks nothing here)
  liquid.registerFilter('placeholder_svg_tag', {
    handler: (_name: unknown, className?: unknown) =>
      `<svg${className ? ` class="${escapeHtml(text(className))}"` : ''} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 525 525" role="img" aria-label="Placeholder image" preserveAspectRatio="xMidYMid slice"><rect width="525" height="525" fill="#e5e5e5"/><path d="M130 380l100-130 70 85 50-60 45 105z" fill="#c4c4c4"/><circle cx="360" cy="190" r="32" fill="#c4c4c4"/></svg>`,
    raw: true,
  })

  // `{{ article.published_at | time_tag: '%B %d, %Y' }}` (or `format:`): <time datetime="…">
  const dates = new Liquid()
  liquid.registerFilter('time_tag', {
    handler: (value: unknown, ...args: unknown[]) => {
      const { named, rest } = keywords(args)
      const format = text(rest[0] ?? named.format ?? '%B %d, %Y')
      const date = value instanceof Date ? value : new Date(text(value))
      if (Number.isNaN(date.getTime())) return ''
      const shown = dates.parseAndRenderSync('{{ at | date: format }}', { at: date, format })
      return `<time datetime="${date.toISOString()}">${escapeHtml(shown)}</time>`
    },
    raw: true,
  })

  // `{{ 'Read more' | link_to: product.url, title: 'Sneakers' }}`; the text is escaped, unless it is HTML the admin wrote
  liquid.registerFilter('link_to', {
    handler: (label: unknown, url: unknown, ...args: unknown[]) => {
      const { named } = keywords(args)
      const shown = label instanceof SafeHtml ? label.toString() : escapeHtml(text(label))
      return `<a${attributes({ href: url, ...named }, escapeHtml, text)}>${shown}</a>`
    },
    raw: true,
  })

  // `{{ '#336699' | color_lighten: 20 }}`, color_darken, and `color_brightness` (0 to 255)
  liquid.registerFilter('color_lighten', (color: unknown, percent: unknown) =>
    shiftLightness(text(color), Number(text(percent))),
  )
  liquid.registerFilter('color_darken', (color: unknown, percent: unknown) =>
    shiftLightness(text(color), -Number(text(percent))),
  )
  liquid.registerFilter('color_brightness', (color: unknown) => brightness(text(color)))
}

/** ` name="value"` for each entry; names that aren't plain attribute names, and null or false values, are left out; true is a bare name */
function attributes(
  values: Record<string, unknown>,
  escapeHtml: (value: string) => string,
  text: (value: unknown) => string,
) {
  let out = ''
  for (const [name, value] of Object.entries(values)) {
    if (value == null || value === false || (value === '' && name !== 'alt')) continue
    if (!/^[a-zA-Z][a-zA-Z0-9_:.-]*$/.test(name) || /^on/i.test(name)) continue
    out += value === true ? ` ${name}` : ` ${name}="${escapeHtml(text(value))}"`
  }
  return out
}

/** A block tag whose contents are skipped, not even parsed as Liquid: `{% doc %}…{% enddoc %}` */
class IgnoredBlockTag extends Tag {
  constructor(token: TagToken, remainTokens: TopLevelToken[], liquid: Liquid) {
    super(token, remainTokens, liquid)
    const end = `end${token.name}`
    const stream = liquid.parser.parseStream(remainTokens)
    stream
      .on('token', (t: unknown) => {
        if ((t as TagToken).name === end) stream.stop()
      })
      .on('end', () => {
        throw new Error(`tag ${token.getText()} not closed`)
      })
    stream.start()
  }

  render() {}
}

/** `{% style %}…{% endstyle %}`: its contents (Liquid is run in it) go in a <style> element */
class StyleTag extends Tag {
  private templates: Template[] = []

  constructor(token: TagToken, remainTokens: TopLevelToken[], liquid: Liquid) {
    super(token, remainTokens, liquid)
    const stream = liquid.parser.parseStream(remainTokens)
    stream
      .on('template', (template: Template) => this.templates.push(template))
      .on('tag:endstyle', () => stream.stop())
      .on('end', () => {
        throw new Error(`tag ${token.getText()} not closed`)
      })
    stream.start()
  }

  *render(ctx: Context, emitter: Emitter): Generator<unknown, void, unknown> {
    emitter.write('<style>')
    yield this.liquid.renderer.renderTemplates(this.templates, ctx, emitter)
    emitter.write('</style>')
  }
}

/** Page-wide, once per render: what `{% stylesheet %}` and `{% javascript %}` already wrote */
const written = new WeakMap<object, Set<string>>()

/**
 * `{% stylesheet %}` and `{% javascript %}`: the contents are CSS or JavaScript as they are (no Liquid), written once however
 * many times the section is on the page. Shopify gathers them into one file; here they sit in the page where the tag is.
 */
function makeAssetBlock(name: string, element: 'style' | 'script') {
  return class extends Tag {
    private body: string

    constructor(token: TagToken, remainTokens: TopLevelToken[], liquid: Liquid) {
      super(token, remainTokens, liquid)
      const parts: string[] = []
      const stream = liquid.parser.parseStream(remainTokens)
      stream
        .on('token', (t: unknown) => {
          if ((t as TagToken).name === `end${name}`) stream.stop()
          else parts.push((t as TopLevelToken).getText())
        })
        .on('end', () => {
          throw new Error(`tag ${token.getText()} not closed`)
        })
      stream.start()
      this.body = parts.join('')
    }

    render(ctx: Context, emitter: Emitter) {
      const seen = written.get(ctx.globals) ?? written.set(ctx.globals, new Set()).get(ctx.globals)!
      const key = `${element}:${this.body}`
      if (seen.has(key)) return
      seen.add(key)
      emitter.write(`<${element}>${this.body}</${element}>`)
    }
  }
}

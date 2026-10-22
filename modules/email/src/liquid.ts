// The Liquid engine notification emails render with (LiquidJS), set up like the storefront's: templates are
// merchant-edited, so no JavaScript runs, nothing is read from disk ({% render %} finds nothing), and
// rendering is time- and memory-limited. Output is HTML-escaped; `| raw` opts out.
import { Liquid, type Context } from 'liquidjs'
import { formatMoney } from '@shopnex/storefront-sdk/money'

/** HTML that's already safe (the rendered body inside the layout); output as is */
export class SafeHtml {
  constructor(private readonly html: string) {}
  toString() {
    return this.html
  }
}

const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&#34;', "'": '&#39;' })[c]!)

const text = (value: unknown): string =>
  value == null ? '' : String(value instanceof Object ? value.valueOf() : value)

// HTML bodies escape every output; subjects are plain text, so they don't
function createLiquid(html: boolean) {
  const liquid = new Liquid({
    // In memory and empty: include/render/layout can't reach the file system
    templates: {},
    strictFilters: true,
    ownPropertyOnly: true,
    outputEscape: html
      ? (value: unknown) => (value instanceof SafeHtml ? value.toString() : escapeHtml(text(value)))
      : undefined,
    parseLimit: 1e5,
    renderLimit: 1_000,
    memoryLimit: 1e7,
  })

  // `escape` is a no-op on top of the automatic escaping instead of escaping twice
  liquid.registerFilter('escape', { handler: (value: unknown) => escapeHtml(text(value)), raw: html })
  /** Multi-line text (payment instructions, notes) with line breaks kept */
  liquid.registerFilter('newline_to_br', {
    handler: (value: unknown) => escapeHtml(text(value)).replace(/\r?\n/g, '<br>'),
    raw: html,
  })

  /** `{{ order.total_price | money }}`: prices are integers in minor units, in the order's (or shop's) currency */
  liquid.registerFilter('money', function (this: { context: Context }, value: unknown) {
    const amount = Number(text(value))
    if (text(value) === '' || !Number.isFinite(amount)) return ''
    const currency = this.context.getSync(['order', 'currency']) ?? this.context.getSync(['shop', 'currency'])
    return formatMoney({ amountMinor: amount, currencyCode: typeof currency === 'string' ? currency : 'USD' })
  })

  /** `{{ count | pluralize: 'item', 'items' }}` */
  liquid.registerFilter('pluralize', (count: unknown, singular: string, plural: string) =>
    Number(text(count)) === 1 ? singular : plural,
  )
  return liquid
}

const htmlLiquid = createLiquid(true)
const textLiquid = createLiquid(false)

export type LiquidProblem = { message: string; line: number | null }

const problemOf = (error: unknown): LiquidProblem => {
  const message = error instanceof Error ? error.message : String(error)
  const line = /line:(\d+)/.exec(message)?.[1]
  return { message: message.split('\n')[0]!, line: line ? Number(line) : null }
}

/** Null when the template parses */
export function checkLiquid(source: string): LiquidProblem | null {
  try {
    htmlLiquid.parse(source)
    return null
  } catch (error) {
    return problemOf(error)
  }
}

/** `html: false` for subjects: nothing is escaped */
export async function render(source: string, scope: object, { html = true } = {}) {
  try {
    const output = (await (html ? htmlLiquid : textLiquid).parseAndRender(source, scope)) as string
    return { ok: true as const, output }
  } catch (error) {
    return { ok: false as const, problem: problemOf(error) }
  }
}

// Checks edited theme files before they're saved (Online store → Themes → Edit code), so a typo shows in
// the editor instead of breaking the storefront. Syntax only: the storefront's filters and objects aren't
// known here (an unknown filter fails when the page renders, in the preview).
import { Liquid, Tag, type TagToken, type TopLevelToken } from 'liquidjs'

// The storefront's own tags (templates/storefront/src/core/liquid.ts); only their syntax matters here
class SectionsTag extends Tag {
  constructor(token: TagToken, remainTokens: TopLevelToken[], liquid: Liquid) {
    super(token, remainTokens, liquid)
    const page = this.tokenizer.readValue()
    if (!page || !('content' in page) || typeof page.content !== 'string')
      throw new Error(`{% sections %} needs a page id, like {% sections 'home' %}`)
  }
  *render() {}
}

const liquid = new Liquid({ strictFilters: false, parseLimit: 1e6 })
liquid.registerTag('sections', SectionsTag)

export type LiquidProblem = { message: string; line: number | null }

/** Null when the template parses */
export function checkLiquid(source: string): LiquidProblem | null {
  try {
    liquid.parse(source)
    return null
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const line = /line:(\d+)/.exec(message)?.[1]
    return { message: message.split('\n')[0]!, line: line ? Number(line) : null }
  }
}

// What we ask for, whichever provider answers: the same instructions, facts and output shapes for every model.
// Shopnex checks the answer against the capability's own schema; these only tell the model what to write.
import { z } from 'zod'
import type { AiBuiltinProvider } from '@shopnex/db/schema'
import type { AiProduct, AiRunRequest } from '@shopnex/marketplace-sdk/ai'

export type Settings = {
  provider: AiBuiltinProvider
  model: string
  /** How the shop sounds, applied to everything written for it */
  brandVoice: string
}

/** A failure staff should read as is (bad key, rate limit, refusal…) */
export class GenerationError extends Error {}

const LENGTHS = {
  short: 'about 50 to 80 words: one short paragraph',
  medium: 'about 120 to 180 words: a short paragraph, then a few bullet points',
  long: 'about 250 to 350 words: two or three paragraphs and a bullet list of details',
} as const

export const SYSTEM = `You write copy for an online shop's product pages and search listings.

Write in the language the product's title and description are written in. Use only facts you are given: the
product's own text, options, variants, tags and collections. Never invent materials, sizes, certifications,
measurements or claims you weren't given; leave out what you don't know rather than guessing. No prices: they
change and are shown elsewhere on the page.`

// Kept small and stable for the model: what the copy needs, not ids or URLs
const productFacts = (p: AiProduct) =>
  JSON.stringify(
    {
      title: p.title,
      description: p.description || undefined,
      vendor: p.vendor || undefined,
      productType: p.productType || undefined,
      tags: p.tags.length ? p.tags : undefined,
      collections: p.collections.length ? p.collections : undefined,
      options: p.options.length ? p.options : undefined,
      variants: p.variants.length > 1 ? p.variants.map((v) => v.title) : undefined,
    },
    null,
    2,
  )

const voice = (settings: Settings) =>
  settings.brandVoice.trim() ? `\n\nThe shop's brand voice:\n${settings.brandVoice.trim()}` : ''

const staff = (instructions?: string) =>
  instructions ? `\n\nInstructions from the shop's staff:\n${instructions}` : ''

const descriptionSchema = z.object({
  descriptionHtml: z
    .string()
    .describe('The description as HTML using only <p>, <ul>, <li>, <strong> and <em>. No headings, no title.'),
})

const seoSchema = z.object({
  title: z.string().describe('Page title, at most 60 characters'),
  description: z.string().describe('Meta description, 140 to 160 characters'),
})

// Output cap per run, thinking included: what the copy needs with room for a little reasoning, so one click can't
// run long or costly. Measured on gpt-5-nano at low reasoning: ~650 tokens for a medium description, ~850 for SEO.
const MAX_TOKENS = { 'product.description': 4096, 'product.seo': 2048 } as const

/** The request for one run: the output schema (and its name, for providers that want one), the prompt and the cap */
export function prompt(request: AiRunRequest, settings: Settings) {
  const product = `\n\nProduct:\n${productFacts(request.subject.product)}`
  const shop = `Shop: ${request.shop.name}\n\n`
  switch (request.capability) {
    case 'product.description': {
      const { tone = 'neutral', length = 'medium', instructions } = request.input
      return {
        name: 'product_description',
        maxTokens: MAX_TOKENS['product.description'],
        schema: descriptionSchema,
        text:
          `${shop}Write this product's description. Tone: ${tone}. Length: ${LENGTHS[length]}. Lead with what the ` +
          `product is and why someone would want it; keep details scannable.` +
          voice(settings) +
          staff(instructions) +
          product,
      }
    }
    case 'product.seo':
      return {
        name: 'product_seo',
        maxTokens: MAX_TOKENS['product.seo'],
        schema: seoSchema,
        text:
          `${shop}Write this product's search engine listing: a page title of at most 60 characters and a meta ` +
          `description of 140 to 160 characters that would make a shopper click. Put the most important words ` +
          `first; no quotation marks, no all-caps.` +
          voice(settings) +
          staff(request.input.instructions) +
          product,
      }
  }
}

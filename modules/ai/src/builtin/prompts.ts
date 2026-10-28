// What we ask for, whichever provider answers: the same instructions, facts and output shapes for every model.
// Shopnex checks the answer against the capability's own schema; these only tell the model what to write.
import { z } from 'zod'
import type { AiBuiltinProvider } from '@shopnex/db/schema'
import type { AiCollection, AiProduct, AiRunRequest } from '@shopnex/marketplace-sdk/ai'

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

Write in the language the product's (or collection's, or page's) title and text are written in. Use only facts you are given: the
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

const imageAltSchema = z.object({
  images: z.array(
    z.object({
      position: z.number().describe("The image's number, as listed in the request (starting at 0)"),
      alt: z.string().describe('Alt text, at most 125 characters'),
    }),
  ),
})

const classifySchema = z.object({
  productType: z.string().describe('One short product type, e.g. "T-shirt"; empty when unsure'),
  tags: z.array(z.string()).describe('3 to 8 short, lowercase tags'),
  collections: z.array(z.string()).describe('Handles of the listed collections the product belongs in; none if unsure'),
})

const pageSchema = z.object({
  title: z.string().describe('The page title, e.g. "Shipping & returns"'),
  bodyHtml: z
    .string()
    .describe(
      'The page as HTML using only <h2>, <h3>, <p>, <ul>, <ol>, <li>, <strong> and <em>. No <h1>, and do not repeat the title in the body: start with the first paragraph or section heading.',
    ),
})

// Output cap per run, thinking included: what the copy needs with room for a little reasoning, so one click can't
// run long or costly. Measured on gpt-5-nano at low reasoning: ~650 tokens for a medium description, ~850 for SEO.
const MAX_TOKENS = {
  'product.description': 4096,
  'product.seo': 2048,
  'product.image_alt': 3072,
  'product.classify': 2048,
  'collection.description': 4096,
  'collection.seo': 2048,
  'page.content': 8192,
} as const

/** Images a model is asked to describe in one run */
export const MAX_ALT_IMAGES = 10

const collectionFacts = (c: AiCollection) =>
  JSON.stringify(
    {
      title: c.title,
      description: c.description || undefined,
      productCount: c.productCount,
      products: c.products.length ? c.products : undefined,
    },
    null,
    2,
  )

/** The shop's catalog, as far as the request shares it */
const catalogFacts = (catalog: NonNullable<AiRunRequest['shop']['catalog']>) =>
  JSON.stringify(
    {
      collections: catalog.collections.length ? catalog.collections : undefined,
      productTypes: catalog.productTypes.length ? catalog.productTypes : undefined,
      sampleProducts: catalog.products.length ? catalog.products : undefined,
    },
    null,
    2,
  )

/** The images to show the model (with their position) for product.image_alt */
export function altImages(request: Extract<AiRunRequest, { capability: 'product.image_alt' }>) {
  const { onlyMissing = true } = request.input
  return request.subject.product.images
    .map((image, position) => ({ ...image, position }))
    .filter((image) => !onlyMissing || !image.alt)
    .slice(0, MAX_ALT_IMAGES)
}

/**
 * The request for one run: the output schema (and its name, for providers that want one), the prompt, the cap,
 * and the images the model should look at (URLs it can fetch)
 */
export function prompt(request: AiRunRequest, settings: Settings) {
  const shop = `Shop: ${request.shop.name}\n\n`
  const base = (name: string, schema: z.ZodType, text: string, images: string[] = []) => ({
    name,
    schema,
    text,
    images,
    maxTokens: MAX_TOKENS[request.capability],
  })
  switch (request.capability) {
    case 'product.description': {
      const { tone = 'neutral', length = 'medium', instructions } = request.input
      return base(
        'product_description',
        descriptionSchema,
        `${shop}Write this product's description. Tone: ${tone}. Length: ${LENGTHS[length]}. Lead with what the ` +
          `product is and why someone would want it; keep details scannable.` +
          voice(settings) +
          staff(instructions) +
          `\n\nProduct:\n${productFacts(request.subject.product)}`,
      )
    }
    case 'product.seo':
      return base(
        'product_seo',
        seoSchema,
        `${shop}Write this product's search engine listing: a page title of at most 60 characters and a meta ` +
          `description of 140 to 160 characters that would make a shopper click. Put the most important words ` +
          `first; no quotation marks, no all-caps.` +
          voice(settings) +
          staff(request.input.instructions) +
          `\n\nProduct:\n${productFacts(request.subject.product)}`,
      )
    case 'product.image_alt': {
      const images = altImages(request)
      return base(
        'product_image_alt',
        imageAltSchema,
        `${shop}Write alt text for each of this product's images, attached in order as images ${images
          .map((i) => i.position)
          .join(', ')}. Describe what is actually visible (the product, colour, angle, setting) in one plain ` +
          `sentence of at most 125 characters, for someone who can't see it. No "image of" or "picture of", no ` +
          `marketing language; work the product's name in naturally where it fits. Answer with one entry per image, ` +
          `using the numbers given.` +
          staff(request.input.instructions) +
          `\n\nProduct:\n${productFacts(request.subject.product)}`,
        images.map((i) => i.url),
      )
    }
    case 'product.classify': {
      const catalog = request.shop.catalog
      return base(
        'product_classify',
        classifySchema,
        `${shop}Suggest how to organize this product: a product type, tags, and which of the shop's collections it ` +
          `belongs in. Prefer the product types and tags the shop already uses, written exactly as listed, over new ` +
          `ones; only add a new tag when nothing existing fits. For collections, answer only with handles from the ` +
          `list below, and only when the product clearly belongs there.` +
          staff(request.input.instructions) +
          `\n\nThe shop's catalog:\nCollections: ${JSON.stringify(catalog?.collections ?? [])}\n` +
          `Product types in use: ${JSON.stringify(catalog?.productTypes ?? [])}\n` +
          `Tags in use: ${JSON.stringify(catalog?.tags ?? [])}` +
          `\n\nProduct:\n${productFacts(request.subject.product)}`,
      )
    }
    case 'collection.description': {
      const { tone = 'neutral', length = 'medium', instructions } = request.input
      return base(
        'collection_description',
        descriptionSchema,
        `${shop}Write this collection's description for its page: what the shop's customers find in it and why it ` +
          `belongs together. Tone: ${tone}. Length: ${LENGTHS[length]}. Describe the range as a whole; don't list ` +
          `every product.` +
          voice(settings) +
          staff(instructions) +
          `\n\nCollection:\n${collectionFacts(request.subject.collection)}`,
      )
    }
    case 'collection.seo':
      return base(
        'collection_seo',
        seoSchema,
        `${shop}Write this collection's search engine listing: a page title of at most 60 characters and a meta ` +
          `description of 140 to 160 characters that would make a shopper click. Put the most important words ` +
          `first; no quotation marks, no all-caps.` +
          voice(settings) +
          staff(request.input.instructions) +
          `\n\nCollection:\n${collectionFacts(request.subject.collection)}`,
      )
    case 'page.content': {
      const { kind, tone = 'neutral', length = 'medium', instructions } = request.input
      const page = request.subject.page
      const catalog = request.shop.catalog
      return base(
        'page_content',
        pageSchema,
        `${shop}Write the "${kind}" page for this shop's website. Tone: ${tone}. Length: ${LENGTHS[length]}. ` +
          `Use headings to break it up, but never open the body with the page's title: the page shows its title on its own. Policies, times, fees, addresses and contact details are not yours to make ` +
          `up: use only the ones in the staff's instructions, and where a page needs one that wasn't given, write ` +
          `a clear placeholder in square brackets such as [return window in days] for the shop to fill in.` +
          voice(settings) +
          staff(instructions) +
          `\n\nShop facts:\n` +
          JSON.stringify({
            name: request.shop.name,
            currency: request.shop.currency,
            website: request.shop.storefrontUrl ?? undefined,
          }) +
          (catalog ? `\n\nWhat the shop sells:\n${catalogFacts(catalog)}` : '') +
          (page?.body
            ? `\n\nThe page's current text, to improve rather than start over:\n${page.body.slice(0, 6000)}`
            : ''),
      )
    }
  }
}

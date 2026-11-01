// AI apps: the contract between a Shopnex instance and an app that provides AI capabilities (product
// descriptions, SEO, image alt text, classification, collection and page copy). Shopnex owns the commerce side (who may ask, which data the app sees, what is saved); the
// app owns the AI side (provider, model, prompts, keys). Any provider works without changing Shopnex.
//
//   1. The app registers what it provides for the shop: POST /api/v1/admin/ai-app/configure
//      (scope write_ai_capabilities) with a URL per capability on its own origin.
//   2. Staff (or an integration) ask Shopnex: POST /api/v1/admin/ai/run { capability, productId | collectionId |
//      pageId, input }. Shopnex loads the subject itself and POSTs a signed AiRunRequest to the capability's URL.
//   3. The app answers 200 AiRunResponse { output, usage? } within 60 seconds. Shopnex checks the output
//      against the capability's schema and returns it as a suggestion: nothing is saved until staff save it.
//
// Capabilities are versioned and only ever change additively; a breaking change is a new capability name.
// Requests are signed with the instance's key (see ./signed-request).
import { z } from 'zod'
import type { KeyResolver, Signer } from './keys'
import { signInstanceRequest, verifyInstanceRequest } from './signed-request'

const instructions = z.string().trim().max(500)

export const AI_TONES = ['neutral', 'warm', 'playful', 'luxury', 'technical'] as const
export const AI_LENGTHS = ['short', 'medium', 'long'] as const

const seoOutput = z.object({
  /** Page title; search engines show about 60 characters */
  title: z.string().trim().min(1).max(200),
  /** Meta description; search engines show about 160 characters */
  description: z.string().trim().min(1).max(500),
})
const descriptionOutput = z.object({
  /** Basic HTML (p, ul, li, strong, em…); Shopnex sanitizes it like any description */
  descriptionHtml: z.string().trim().min(1).max(100_000),
})

/** The pages a shop usually needs; "other" is whatever the instructions ask for */
export const AI_PAGE_KINDS = ['about', 'faq', 'shipping', 'returns', 'privacy', 'terms', 'other'] as const

/** Every capability: what the subject is, what the caller may pass, what the app must answer */
export const aiCapabilities = {
  'product.description': {
    version: 1,
    subject: 'product',
    input: z.object({
      tone: z.enum(AI_TONES).optional(),
      length: z.enum(AI_LENGTHS).optional(),
      /** Free text from staff, e.g. "mention it's machine washable" */
      instructions: instructions.optional(),
    }),
    output: descriptionOutput,
  },
  'product.seo': {
    version: 1,
    subject: 'product',
    input: z.object({ instructions: instructions.optional() }),
    output: seoOutput,
  },
  'product.image_alt': {
    version: 1,
    subject: 'product',
    // Needs a model that can see images
    input: z.object({
      /** Keep the alt text images already have */
      onlyMissing: z.boolean().optional(),
      instructions: instructions.optional(),
    }),
    output: z.object({
      /** One entry per image described; position is the image's index in the product's images (from 0) */
      images: z
        .array(z.object({ position: z.number().int().min(0).max(99), alt: z.string().trim().min(1).max(300) }))
        .max(100),
    }),
  },
  'product.classify': {
    version: 1,
    subject: 'product',
    input: z.object({ instructions: instructions.optional() }),
    output: z.object({
      productType: z.string().trim().max(100),
      tags: z.array(z.string().trim().min(1).max(50)).max(20),
      /** Handles of the shop's existing collections the product belongs in; never new ones */
      collections: z.array(z.string().trim().min(1).max(200)).max(20),
    }),
  },
  'collection.description': {
    version: 1,
    subject: 'collection',
    input: z.object({
      tone: z.enum(AI_TONES).optional(),
      length: z.enum(AI_LENGTHS).optional(),
      instructions: instructions.optional(),
    }),
    output: descriptionOutput,
  },
  'collection.seo': {
    version: 1,
    subject: 'collection',
    input: z.object({ instructions: instructions.optional() }),
    output: seoOutput,
  },
  'page.content': {
    version: 1,
    // A page being written may not exist yet: the subject is the page when it does
    subject: 'page',
    input: z.object({
      kind: z.enum(AI_PAGE_KINDS),
      tone: z.enum(AI_TONES).optional(),
      length: z.enum(AI_LENGTHS).optional(),
      /** The facts the page can't be written without (return window, shipping times…) */
      instructions: z.string().trim().max(2000).optional(),
    }),
    output: z.object({
      /** Suggested page title, e.g. "Shipping & returns" */
      title: z.string().trim().min(1).max(200),
      /** Basic HTML (p, h2, h3, ul, ol, li, strong, em, a); sanitized like any page body */
      bodyHtml: z.string().trim().min(1).max(200_000),
    }),
  },
} as const

export type AiCapability = keyof typeof aiCapabilities
export const AI_CAPABILITIES = Object.keys(aiCapabilities) as [AiCapability, ...AiCapability[]]
export type AiInput<C extends AiCapability = AiCapability> = z.infer<(typeof aiCapabilities)[C]['input']>
export type AiOutput<C extends AiCapability = AiCapability> = z.infer<(typeof aiCapabilities)[C]['output']>

/** What the app may report about the call (shown to staff, kept with the generation) */
export const aiUsage = z.object({
  model: z.string().max(200).optional(),
  inputTokens: z.number().int().nonnegative().optional(),
  outputTokens: z.number().int().nonnegative().optional(),
})
export type AiUsage = z.infer<typeof aiUsage>

/** Checks an app's answer for a capability */
export const aiRunResponse = <C extends AiCapability>(capability: C) =>
  z.object({ output: aiCapabilities[capability].output, usage: aiUsage.optional() })

export type AiRunResponse<C extends AiCapability = AiCapability> = { output: AiOutput<C>; usage?: AiUsage }

/** The product as the app sees it: what a description or SEO text needs, nothing about orders or customers */
export type AiProduct = {
  id: string
  title: string
  /** The current description as plain text ('' when there is none) */
  description: string
  vendor: string
  productType: string
  tags: string[]
  seo: { title: string | null; description: string | null }
  options: { name: string; values: string[] }[]
  /** Up to 50 */
  variants: { title: string; sku: string | null; price: { cents: number; currency: string } }[]
  images: { url: string; alt: string | null }[]
  /** Collection handles */
  collections: string[]
}

/** The collection as the app sees it: its own text and a sample of what's in it */
export type AiCollection = {
  id: string
  title: string
  handle: string
  /** The current description as plain text ('' when there is none) */
  description: string
  seo: { title: string | null; description: string | null }
  productCount: number
  /** Up to 30 products */
  products: { title: string; productType: string; tags: string[] }[]
}

/** The page being edited, or null when it hasn't been saved yet */
export type AiPage = { id: string; title: string; handle: string; body: string }

type AiRunRequestBase = {
  kind: 'ai.run'
  /** The generation id: idempotency key for retries, and what staff feedback refers to */
  id: string
  /** The Shopnex instance's public origin: its keys sign this request */
  instance: string
  shopId: string
  version: number
  shop: {
    name: string
    currency: string
    storefrontUrl: string | null
    /** The shop's catalog, for what needs it (product.classify, page.content): never more than listed here */
    catalog?: {
      collections: { handle: string; title: string }[]
      productTypes: string[]
      tags: string[]
      /** A sample of what the shop sells */
      products: { title: string; productType: string }[]
    }
  }
}

type AiSubjects = {
  product: { type: 'product'; product: AiProduct }
  collection: { type: 'collection'; collection: AiCollection }
  page: { type: 'page'; page: AiPage | null }
}

export type AiRunRequest = {
  [C in AiCapability]: AiRunRequestBase & {
    capability: C
    input: AiInput<C>
    subject: AiSubjects[(typeof aiCapabilities)[C]['subject']]
  }
}[AiCapability]

/** Instance side: headers for one request with this exact body */
export const signAiRequest = (signer: Signer, id: string, body: string, now = new Date()) =>
  signInstanceRequest(signer, id, body, 'Shopnex-AI/1.0', now)

/**
 * App side: checks the signature (with the keys of the instance the body names) and that it's under 5 minutes
 * old, and returns the parsed request, or null. Pass the raw body text, not re-serialized JSON.
 */
export async function verifyAiRequest(
  headers: Headers,
  body: string,
  options: { keys: KeyResolver; toleranceSeconds?: number },
) {
  const request = await verifyInstanceRequest<AiRunRequest>(headers, body, options)
  return request?.kind === 'ai.run' ? request : null
}

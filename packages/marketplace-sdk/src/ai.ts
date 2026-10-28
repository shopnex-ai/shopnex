// AI apps: the contract between a Shopnex instance and an app that provides AI capabilities (product
// descriptions, SEO…). Shopnex owns the commerce side (who may ask, which data the app sees, what is saved); the
// app owns the AI side (provider, model, prompts, keys). Any provider works without changing Shopnex.
//
//   1. The app registers what it provides for the shop: POST /api/v1/admin/ai-app/configure
//      (scope write_ai_capabilities) with a URL per capability on its own origin.
//   2. Staff (or an integration) ask Shopnex: POST /api/v1/admin/ai/run { capability, productId, input }.
//      Shopnex loads the product itself and POSTs a signed AiRunRequest to the capability's URL.
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
    output: z.object({
      /** Basic HTML (p, ul, li, strong, em…); Shopnex sanitizes it like any description */
      descriptionHtml: z.string().trim().min(1).max(100_000),
    }),
  },
  'product.seo': {
    version: 1,
    subject: 'product',
    input: z.object({ instructions: instructions.optional() }),
    output: z.object({
      /** Page title; search engines show about 60 characters */
      title: z.string().trim().min(1).max(200),
      /** Meta description; search engines show about 160 characters */
      description: z.string().trim().min(1).max(500),
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

type AiRunRequestBase = {
  kind: 'ai.run'
  /** The generation id: idempotency key for retries, and what staff feedback refers to */
  id: string
  /** The Shopnex instance's public origin: its keys sign this request */
  instance: string
  shopId: string
  version: number
  shop: { name: string; currency: string; storefrontUrl: string | null }
  subject: { type: 'product'; product: AiProduct }
}

export type AiRunRequest = {
  [C in AiCapability]: AiRunRequestBase & { capability: C; input: AiInput<C> }
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

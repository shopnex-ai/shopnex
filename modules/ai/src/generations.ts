// Business logic only — no HTTP / oRPC / Hono imports in this module (outbound calls to apps aside).
// Running a capability: Shopnex picks the app, builds the context itself (the app never reads the shop's data
// on its own), sends a signed request and checks the answer against the capability's schema. The result is a
// suggestion: saving it is an ordinary write by whoever asked.
import { randomUUID } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { instanceSigner, instanceUrl } from '@shopnex/apps'
import { htmlToText, productService, sanitizeHtml, type ProductWithDetails } from '@shopnex/catalog'
import { db, schema } from '@shopnex/db'
import type { AiFeedback } from '@shopnex/db/schema'
import {
  aiCapabilities,
  aiRunResponse,
  signAiRequest,
  type AiCapability,
  type AiInput,
  type AiOutput,
  type AiProduct,
  type AiRunRequest,
  type AiUsage,
} from '@shopnex/marketplace-sdk/ai'
import { AiError } from './errors'
import { providers } from './providers'

// Models are slow; staff are waiting on the other end, so not much longer than this
const TIMEOUT_MS = 60_000
const MAX_VARIANTS = 50

export type RunInput<C extends AiCapability = AiCapability> = {
  capability: C
  /** The product (every capability so far has a product subject) */
  subjectId: string
  input?: AiInput<C>
  /** Use this app instead of the shop's default for the capability */
  appId?: string
  /** Staff who asked; null for an API token */
  userId?: string | null
}

export type RunResult<C extends AiCapability = AiCapability> = {
  id: string
  capability: C
  app: { id: string; name: string }
  output: AiOutput<C>
  usage: AiUsage | null
}

const toAiProduct = (p: ProductWithDetails, currency: string): AiProduct => ({
  id: p.id,
  title: p.title,
  description: p.descriptionHtml ? htmlToText(p.descriptionHtml) : (p.description ?? ''),
  vendor: p.vendor,
  productType: p.productType,
  tags: p.tags,
  seo: { title: p.seoTitle, description: p.seoDescription },
  options: p.options.map((o) => ({ name: o.name, values: o.values })),
  variants: p.variants.slice(0, MAX_VARIANTS).map((v) => ({
    title: v.title,
    sku: v.sku,
    price: { cents: v.priceCents, currency },
  })),
  images: p.images.map((i) => ({ url: i.url, alt: i.alt })),
  collections: p.collectionSlugs,
})

const message = (error: unknown) => (error instanceof Error ? error.message : String(error))

// An app explains a failure as { error }: that's what staff should read
const appError = (text: string) => {
  try {
    const { error } = JSON.parse(text) as { error?: unknown }
    return typeof error === 'string' && error ? error.slice(0, 300) : null
  } catch {
    return null
  }
}

async function post(url: string, id: string, body: string) {
  const res = await fetch(url, {
    method: 'POST',
    headers: await signAiRequest(await instanceSigner(), id, body),
    body,
    redirect: 'manual',
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  const text = await res.text().catch(() => '')
  if (!res.ok) throw new Error(appError(text) ?? `${res.status} ${text.slice(0, 300) || res.statusText}`)
  try {
    return JSON.parse(text) as unknown
  } catch {
    throw new Error('The app answered something other than JSON')
  }
}

// Whatever the app says, a description is stored like any other: sanitized
function clean<C extends AiCapability>(capability: C, output: AiOutput<C>): AiOutput<C> {
  if (capability === 'product.description') {
    const o = output as AiOutput<'product.description'>
    return { ...o, descriptionHtml: sanitizeHtml(o.descriptionHtml) } as AiOutput<C>
  }
  return output
}

export async function run<C extends AiCapability>(shopId: string, request: RunInput<C>): Promise<RunResult<C>> {
  const { capability } = request
  const definition = aiCapabilities[capability]
  const input = definition.input.parse(request.input ?? {}) as AiInput<C>

  const candidates = await providers(shopId, [capability])
  const provider = request.appId ? candidates.find((p) => p.app.id === request.appId) : candidates[0]
  if (!provider) {
    throw new AiError(
      'CAPABILITY_UNAVAILABLE',
      request.appId
        ? `That app doesn't provide ${capability} in this shop`
        : `No installed app provides ${capability}. Install an AI app first.`,
    )
  }

  const [product, [shop]] = await Promise.all([
    productService.getById(shopId, request.subjectId),
    db.select().from(schema.shops).where(eq(schema.shops.id, shopId)),
  ])
  if (!product || !shop) throw new AiError('SUBJECT_NOT_FOUND', 'Product not found')
  const [details] = await productService.withDetails([product])

  const id = randomUUID()
  const body = JSON.stringify({
    kind: 'ai.run',
    id,
    instance: await instanceUrl(),
    shopId,
    capability,
    version: definition.version,
    input,
    shop: { name: shop.name, currency: shop.currency, storefrontUrl: shop.storefrontUrl },
    subject: { type: 'product', product: toAiProduct(details!, shop.currency) },
  } as AiRunRequest)

  const record = {
    id,
    shopId,
    appId: provider.app.id,
    capability,
    subjectType: definition.subject,
    subjectId: product.id,
    input,
    userId: request.userId ?? null,
  }
  const started = Date.now()
  let result: { output: AiOutput<C>; usage?: AiUsage }
  try {
    const parsed = aiRunResponse(capability).safeParse(await post(provider.url, id, body))
    if (!parsed.success) {
      throw new Error(`The app's answer doesn't match ${capability}: ${parsed.error.issues[0]?.message ?? ''}`)
    }
    result = parsed.data as typeof result
  } catch (error) {
    const errorMessage = message(error).slice(0, 500)
    await db
      .insert(schema.aiGenerations)
      .values({ ...record, status: 'failed', errorMessage, durationMs: Date.now() - started })
    throw new AiError('PROVIDER_FAILED', `${provider.app.name} couldn't do this: ${errorMessage}`)
  }

  const output = clean(capability, result.output)
  await db.insert(schema.aiGenerations).values({
    ...record,
    status: 'succeeded',
    output,
    usage: result.usage ?? null,
    durationMs: Date.now() - started,
  })
  return { id, capability, app: { id: provider.app.id, name: provider.app.name }, output, usage: result.usage ?? null }
}

/** Staff used the suggestion or dismissed it */
export async function feedback(shopId: string, id: string, value: AiFeedback) {
  const [row] = await db
    .update(schema.aiGenerations)
    .set({ feedback: value })
    .where(
      and(
        eq(schema.aiGenerations.shopId, shopId),
        eq(schema.aiGenerations.id, id),
        eq(schema.aiGenerations.status, 'succeeded'),
      ),
    )
    .returning({ id: schema.aiGenerations.id, feedback: schema.aiGenerations.feedback })
  if (!row) throw new AiError('GENERATION_NOT_FOUND', 'Generation not found')
  return row
}

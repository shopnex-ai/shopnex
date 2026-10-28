// Business logic only — no HTTP / oRPC / Hono imports in this module (outbound calls to providers aside).
// Running a capability: Shopnex picks the provider (built-in AI from Settings → AI first, then installed apps),
// builds the context itself (a provider never reads the shop's data on its own) and checks the answer against the
// capability's schema. The result is a suggestion: saving it is an ordinary write by whoever asked.
import { randomUUID } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { instanceSigner, instanceUrl } from '@shopnex/apps'
import { sanitizeHtml } from '@shopnex/catalog'
import { db, schema } from '@shopnex/db'
import type { AiFeedback } from '@shopnex/db/schema'
import {
  aiCapabilities,
  aiRunResponse,
  signAiRequest,
  type AiCapability,
  type AiInput,
  type AiOutput,
  type AiRunRequest,
  type AiUsage,
} from '@shopnex/marketplace-sdk/ai'
import * as builtin from './builtin'
import { AiError } from './errors'
import { BUILTIN, providers } from './providers'
import * as subjects from './subjects'

// Models are slow; staff are waiting on the other end, so not much longer than this
const TIMEOUT_MS = 60_000

export type RunInput<C extends AiCapability = AiCapability> = {
  capability: C
  /** The product or collection the capability is about; for page.content the page, if it exists yet */
  subjectId?: string
  input?: AiInput<C>
  /** BUILTIN or an app's id, instead of the shop's default for the capability */
  providerId?: string
  /** Staff who asked; null for an API token */
  userId?: string | null
}

export type RunResult<C extends AiCapability = AiCapability> = {
  id: string
  capability: C
  /** BUILTIN or the app's id */
  provider: { id: string; name: string }
  output: AiOutput<C>
  usage: AiUsage | null
}

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

// Whoever wrote it, copy is stored like any other: sanitized. And a suggestion can only name what exists
function clean<C extends AiCapability>(request: AiRunRequest, output: AiOutput<C>): AiOutput<C> {
  switch (request.capability) {
    case 'product.description':
    case 'collection.description': {
      const o = output as AiOutput<'product.description'>
      return { ...o, descriptionHtml: sanitizeHtml(o.descriptionHtml) } as AiOutput<C>
    }
    case 'page.content': {
      const o = output as AiOutput<'page.content'>
      return { ...o, bodyHtml: sanitizeHtml(o.bodyHtml) } as AiOutput<C>
    }
    case 'product.image_alt': {
      const o = output as AiOutput<'product.image_alt'>
      const known = request.subject.product.images.length
      const seen = new Set<number>()
      const images = o.images.filter((i) => i.position < known && !seen.has(i.position) && seen.add(i.position))
      return { images } as AiOutput<C>
    }
    case 'product.classify': {
      const o = output as AiOutput<'product.classify'>
      const handles = new Set(request.shop.catalog?.collections.map((c) => c.handle))
      return {
        productType: o.productType,
        tags: [...new Set(o.tags.map((t) => t.trim()).filter(Boolean))],
        collections: [...new Set(o.collections)].filter((handle) => handles.has(handle)),
      } as AiOutput<C>
    }
    default:
      return output
  }
}

export async function run<C extends AiCapability>(shopId: string, request: RunInput<C>): Promise<RunResult<C>> {
  const { capability } = request
  const definition = aiCapabilities[capability]
  const input = definition.input.parse(request.input ?? {}) as AiInput<C>

  // Built-in AI is the default when it's on; an app is used when asked for, or when built-in AI is off
  const [own, apps] = await Promise.all([builtin.active(shopId), providers(shopId, [capability])])
  const wanted = request.providerId
  const app = wanted && wanted !== BUILTIN ? apps.find((p) => p.app.id === wanted) : own ? undefined : apps[0]
  const useBuiltin = !app && own && (!wanted || wanted === BUILTIN)
  if (!app && !useBuiltin) {
    throw new AiError(
      'CAPABILITY_UNAVAILABLE',
      wanted
        ? `That provider doesn't offer ${capability} in this shop`
        : `Nothing provides ${capability} yet. Turn on AI in Settings → AI.`,
    )
  }
  const provider = app ? { id: app.app.id, name: app.app.name } : { id: BUILTIN, name: own!.name }

  const [shop] = await db.select().from(schema.shops).where(eq(schema.shops.id, shopId))
  if (!shop) throw new AiError('SUBJECT_NOT_FOUND', 'Shop not found')
  const needSubject = () => {
    if (!request.subjectId) throw new AiError('SUBJECT_REQUIRED', `${capability} needs a ${definition.subject}`)
    return request.subjectId
  }
  const subject =
    definition.subject === 'product'
      ? { type: 'product', product: await subjects.product(shopId, needSubject(), shop.currency) }
      : definition.subject === 'collection'
        ? { type: 'collection', collection: await subjects.collection(shopId, needSubject()) }
        : { type: 'page', page: await subjects.page(shopId, request.subjectId) }
  // Only what the capability needs: the catalog is shared with those that organize or write about the shop
  const withCatalog = capability === 'product.classify' || capability === 'page.content'

  const id = randomUUID()
  const runRequest = {
    kind: 'ai.run',
    id,
    instance: await instanceUrl(),
    shopId,
    capability,
    version: definition.version,
    input,
    shop: {
      name: shop.name,
      currency: shop.currency,
      storefrontUrl: shop.storefrontUrl,
      ...(withCatalog && { catalog: await subjects.catalog(shopId) }),
    },
    subject,
  } as AiRunRequest

  const record = {
    id,
    shopId,
    appId: app?.app.id ?? null,
    capability,
    subjectType: definition.subject,
    subjectId: request.subjectId ?? null,
    input,
    userId: request.userId ?? null,
  }
  const started = Date.now()
  let result: { output: AiOutput<C>; usage?: AiUsage }
  try {
    const answer = app
      ? await post(app.url, id, JSON.stringify(runRequest))
      : await own!.run(runRequest as AiRunRequest)
    const parsed = aiRunResponse(capability).safeParse(answer)
    if (!parsed.success) {
      throw new Error(`The answer doesn't match ${capability}: ${parsed.error.issues[0]?.message ?? ''}`)
    }
    result = parsed.data as typeof result
  } catch (error) {
    const errorMessage = message(error).slice(0, 500)
    await db
      .insert(schema.aiGenerations)
      .values({ ...record, status: 'failed', errorMessage, durationMs: Date.now() - started })
    throw new AiError('PROVIDER_FAILED', `${provider.name} couldn't do this: ${errorMessage}`)
  }

  const output = clean<C>(runRequest, result.output)
  await db.insert(schema.aiGenerations).values({
    ...record,
    status: 'succeeded',
    output,
    usage: result.usage ?? null,
    durationMs: Date.now() - started,
  })
  return { id, capability, provider, output, usage: result.usage ?? null }
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

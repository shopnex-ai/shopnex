// Webhook payload contract: for every topic, a real payload (the change made through the admin API, read back from
// the outbox) matches the topic's schema, and the schema's fields match the committed snapshot apps rely on.
// Adding a field means updating the snapshot (WEBHOOK_SNAPSHOT=update), a reviewable diff; removing or renaming one
// fails. Uses its own endpoint, product, customer and orders, and removes them at the end.
import assert from 'node:assert/strict'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { after, before, describe, test } from 'node:test'
import { asc, eq } from 'drizzle-orm'
import { z } from 'zod'
import { webhookPayloads } from '@shopnex/api/reference'
import { productService } from '@shopnex/catalog'
import { db, schema } from '@shopnex/db'
import { WEBHOOK_TOPICS, type WebhookTopic } from '@shopnex/db/schema'
import { Fixtures, SHOP, call, closeDb, ok, requireApp } from '../lib'

const SNAPSHOT = new URL('./webhook-payloads.snapshot.json', import.meta.url)
const POLICY = 'see the compatibility policy for webhooks and the Admin API (#310)'

const fx = new Fixtures()
const run = Date.now().toString(36)
const payloads = new Map<WebhookTopic, unknown[]>()
let productId: string | undefined

type JsonSchema = {
  type?: string | string[]
  anyOf?: JsonSchema[]
  items?: JsonSchema
  format?: string
  enum?: unknown[]
  properties?: Record<string, JsonSchema>
}

// Read like the docs' reference (apps/docs/scripts/generate-reference.ts), keeping `null` in a field's type, and
// through nesting: nested objects and arrays of objects, at any depth, list their fields as `parent.field` and
// `parent[].field`. Fields the schema types as free JSON (addresses, tax lines, custom fields) stay one entry.
function typeOf(s: JsonSchema): string {
  if (s.enum) return s.enum.map((v) => JSON.stringify(v)).join(' | ')
  if (s.anyOf) return [...new Set(s.anyOf.map(typeOf))].join(' | ') || 'any'
  const t = Array.isArray(s.type) ? s.type.join(' | ') : s.type
  if (t === 'array') return `${s.items ? typeOf(s.items) : 'any'}[]`
  if (t === 'string' && s.format === 'date-time') return 'string (ISO date)'
  return t ?? 'any'
}

function objectOf(s: JsonSchema): JsonSchema | undefined {
  if (s.properties) return s
  return s.anyOf?.map(objectOf).find(Boolean)
}

function fieldsOf(s: JsonSchema, prefix = ''): Record<string, string> {
  const fields: Record<string, string> = {}
  for (const [name, field] of Object.entries(s.properties ?? {})) {
    const path = prefix + name
    fields[path] = typeOf(field)
    const nested = objectOf(field)
    const items = field.items ? objectOf(field.items) : undefined
    if (nested) Object.assign(fields, fieldsOf(nested, `${path}.`))
    if (items) Object.assign(fields, fieldsOf(items, `${path}[].`))
  }
  return fields
}

const schemaFields = (topic: WebhookTopic) =>
  fieldsOf(
    z.toJSONSchema(webhookPayloads[topic], {
      io: 'output',
      unrepresentable: 'any',
      // Dates are sent as ISO strings
      override: (ctx) => {
        if (ctx.zodSchema._zod.def.type === 'date')
          Object.assign(ctx.jsonSchema, { type: 'string', format: 'date-time' })
      },
    }) as JsonSchema,
  )

// The arrays of objects a schema has (`parent`, `parent[].child`): an empty one checks none of its fields
const arraysOf = (fields: Record<string, string>) =>
  new Set(
    Object.keys(fields).flatMap((f) => {
      const parts = f.split('[].')
      return parts.slice(0, -1).map((_, i) => parts.slice(0, i + 1).join('[].'))
    }),
  )

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !(v instanceof Date)

// The arrays of objects a payload filled, named the same way
function filled(value: unknown, prefix = '', out = new Set<string>()): Set<string> {
  if (!isObject(value) || Array.isArray(value)) return out
  for (const [key, v] of Object.entries(value)) {
    const path = prefix + key
    if (Array.isArray(v) && v.some(isObject)) {
      out.add(path)
      for (const item of v) filled(item, `${path}[].`, out)
    } else filled(v, `${path}.`, out)
  }
  return out
}

// The fields a payload carries that its schema does not declare: zod strips unknown keys when it parses, so
// `safeParse` alone would let a new or leaked field through. Free-JSON fields are one entry, not descended into.
function undeclared(value: unknown, known: Record<string, string>, prefix = '', out: string[] = []): string[] {
  if (!isObject(value)) return out
  for (const [key, v] of Object.entries(value)) {
    const path = prefix + key
    if (!(path in known)) {
      out.push(path)
      continue
    }
    for (const item of Array.isArray(v) ? v : [v]) {
      const next = `${path}${Array.isArray(v) ? '[].' : '.'}`
      if (Object.keys(known).some((k) => k.startsWith(next))) undeclared(item, known, next, out)
    }
  }
  return out
}

// A delivery's body is JSON, so its dates arrive as ISO strings; the schema describes them as dates. Only the
// fields the schemas type as dates are turned back, so a note or a custom field that looks like a date stays text.
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/
const dateFields = new Set(
  WEBHOOK_TOPICS.flatMap((topic) =>
    Object.entries(schemaFields(topic))
      .filter(([, type]) => type.includes('ISO date'))
      .map(([path]) => path.slice(path.lastIndexOf('.') + 1)),
  ),
)
const revive = (key: string, value: unknown) =>
  typeof value === 'string' && dateFields.has(key) && ISO.test(value) ? new Date(value) : value

before(async () => {
  await requireApp()
  await fx.init()
  const token = await fx.token(['write_products', 'write_customers', 'write_orders'])
  const owner = await fx.account('owner')
  const endpoint = ok(
    await call(
      'POST',
      '/admin/webhooks',
      { url: 'https://example.com/e2e-contract', topics: [...WEBHOOK_TOPICS] },
      token,
    ),
  )
  let field: { id: string; key: string } | undefined
  try {
    field = ok(
      await call(
        'POST',
        '/admin/custom-fields',
        { resource: 'order', key: `contract_${run}`, label: 'Contract note', type: 'text' },
        owner.headers,
      ),
    ) as { id: string; key: string }
    // product.created, product.updated, inventory.updated
    const product = ok(
      await call(
        'POST',
        '/admin/products',
        {
          title: `E2E contract ${run}`,
          images: [{ url: 'https://example.com/e2e-contract.png', alt: 'Front' }],
          options: [{ name: 'Size', values: ['S', 'M'] }],
          variants: [
            { priceCents: 1000, inventoryQuantity: 10, options: { Size: 'S' } },
            { priceCents: 1000, inventoryQuantity: 10, options: { Size: 'M' } },
          ],
        },
        token,
      ),
    )
    productId = product.id
    const variantId = product.variants[0].id as string
    ok(await call('PATCH', `/admin/products/${product.id}`, { title: `E2E contract ${run} (renamed)` }, token))
    ok(await call('PATCH', `/admin/variants/${variantId}`, { inventoryQuantity: 9 }, token))

    // customer.created, customer.updated
    const customer = ok(
      await call('POST', '/admin/customers', { email: fx.shopper('contract'), name: 'Contract Test' }, token),
    )
    ok(await call('PATCH', `/admin/customers/${customer.id}`, { name: 'Contract Test Renamed' }, token))

    // order.created, order.updated, order.paid, order.fulfilled; and order.cancelled on a second order placed at
    // checkout, so one order also carries a shipping line
    const created = ok(
      await call('POST', '/admin/orders', { customerId: customer.id, items: [{ variantId, quantity: 1 }] }, token),
    )
    fx.order(created.id)
    const orderId = created.id as string
    ok(await call('PATCH', `/admin/orders/${orderId}`, { customFields: { [field.key]: 'kept' } }, token))
    ok(await call('POST', `/admin/orders/${orderId}/mark-as-paid`, {}, token))
    ok(await call('POST', `/admin/orders/${orderId}/fulfill`, {}, token))
    const cart = await fx.cart([{ merchandiseId: variantId, quantity: 1 }])
    const placed = await fx.complete(cart.id, { countryCode: 'US' }, (await fx.shippingRate(500)).id)
    const cancelled = ok(placed).orderId as string
    fx.order(cancelled)
    ok(await call('POST', `/admin/orders/${cancelled}/cancel`, { reason: 'customer', restock: true }, token))

    const rows = await db
      .select({ topic: schema.webhookDeliveries.topic, body: schema.webhookDeliveries.body })
      .from(schema.webhookDeliveries)
      .where(eq(schema.webhookDeliveries.endpointId, endpoint.id))
      .orderBy(asc(schema.webhookDeliveries.createdAt))
    for (const row of rows) {
      const topic = row.topic as WebhookTopic
      payloads.set(topic, [...(payloads.get(topic) ?? []), JSON.parse(row.body, revive).data])
    }
  } finally {
    await call('DELETE', `/admin/webhooks/${endpoint.id}`, undefined, token)
    if (field) await call('DELETE', `/admin/custom-fields/${field.id}`, undefined, owner.headers)
  }
})

after(async () => {
  await fx.cleanup()
  if (productId) await productService.removeMany(SHOP, [productId])
  await closeDb()
})

describe('webhook payload contract', () => {
  const updating = process.env.WEBHOOK_SNAPSHOT === 'update'
  const snapshot = (existsSync(SNAPSHOT) ? JSON.parse(readFileSync(SNAPSHOT, 'utf8')) : {}) as Record<
    string,
    Record<string, string>
  >

  if (updating) {
    after(() => {
      // A broken setup must not rewrite the baseline: every topic needs a payload from this run
      const missing = WEBHOOK_TOPICS.filter((topic) => !payloads.has(topic))
      assert.deepEqual(missing, [], `snapshot not updated: no payload was queued for ${missing.join(', ')}`)
      const next = Object.fromEntries(WEBHOOK_TOPICS.map((topic) => [topic, schemaFields(topic)]))
      writeFileSync(SNAPSHOT, `${JSON.stringify(next, null, 2)}\n`)
    })
  }

  // Topics sharing a payload schema (the order.* topics) are covered together
  const bySchema = new Map<unknown, WebhookTopic[]>()
  for (const topic of WEBHOOK_TOPICS)
    bySchema.set(webhookPayloads[topic], [...(bySchema.get(webhookPayloads[topic]) ?? []), topic])
  for (const topics of bySchema.values()) {
    test(`${topics.join(', ')}: every array of objects was filled, so its fields were checked`, () => {
      const seen = new Set(topics.flatMap((t) => (payloads.get(t) ?? []).flatMap((p) => [...filled(p)])))
      const empty = [...arraysOf(schemaFields(topics[0]!))].filter((a) => !seen.has(a))
      assert.deepEqual(empty, [], `no payload filled ${empty.join(', ')}: make a change that fills them`)
    })
  }

  for (const topic of WEBHOOK_TOPICS) {
    test(`${topic}: a real payload matches its schema and the snapshot`, () => {
      assert.ok(payloads.has(topic), `nothing queued ${topic}: the test has to make a change that sends it`)
      for (const payload of payloads.get(topic)!) {
        const parsed = webhookPayloads[topic].safeParse(payload)
        assert.ok(parsed.success, `${topic} payload does not match its schema: ${parsed.error?.message}`)
        const extra = undeclared(payload, schemaFields(topic))
        assert.deepEqual(
          extra,
          [],
          `${topic} payload carries fields its schema does not declare (${extra.join(', ')}): declare them in webhookPayloads`,
        )
      }
      if (updating) return

      const recorded = snapshot[topic]
      assert.ok(recorded, `${topic} has no snapshot: run the e2e tests with WEBHOOK_SNAPSHOT=update and commit it`)
      const current = schemaFields(topic)
      const removed = Object.keys(recorded).filter((f) => !(f in current))
      const changed = Object.keys(recorded).filter((f) => f in current && current[f] !== recorded[f])
      assert.deepEqual(
        [...removed, ...changed],
        [],
        `${topic} removed or retyped fields apps may read (${[...removed, ...changed].join(', ')}): ${POLICY}`,
      )
      const added = Object.keys(current).filter((f) => !(f in recorded))
      assert.deepEqual(
        added,
        [],
        `${topic} has new fields (${added.join(', ')}): adding is allowed, rerun with WEBHOOK_SNAPSHOT=update and commit the snapshot`,
      )
    })
  }
})

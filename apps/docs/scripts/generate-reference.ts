// Writes the facts the docs repeat (API scopes, webhook topics and payloads, delivery timings) to
// generated/reference.json, straight from the code. The <Scopes />, <WebhookTopics /> ... components render it,
// so these pages cannot drift from the product. Runs before dev, build and typecheck, with no instance or database.
import { mkdir, writeFile } from 'node:fs/promises'
import { z } from 'zod'
import {
  API_SCOPES,
  API_SCOPE_DESCRIPTIONS,
  RETENTION_MS,
  RETRY_DELAYS_S,
  TIMEOUT_MS,
  WEBHOOK_TEST_TOPIC,
  WEBHOOK_TOPICS,
  WEBHOOK_TOPIC_DESCRIPTIONS,
  webhookPayloads,
} from '@shopnex/api/reference'

type Field = { name: string; type: string; nullable: boolean }
type JsonSchema = {
  type?: string | string[]
  anyOf?: JsonSchema[]
  items?: JsonSchema
  format?: string
  enum?: unknown[]
  properties?: Record<string, JsonSchema>
}

function typeOf(s: JsonSchema): string {
  if (s.enum) return s.enum.map((v) => JSON.stringify(v)).join(' | ')
  if (s.anyOf) return [...new Set(s.anyOf.map(typeOf).filter((t) => t !== 'null'))].join(' | ') || 'any'
  const t = Array.isArray(s.type) ? s.type.filter((x) => x !== 'null').join(' | ') : s.type
  if (t === 'array') return `${s.items ? typeOf(s.items) : 'any'}[]`
  if (t === 'string' && s.format === 'date-time') return 'string (ISO date)'
  return t ?? 'any'
}
const isNullable = (s: JsonSchema) =>
  (Array.isArray(s.type) && s.type.includes('null')) || !!s.anyOf?.some((x) => x.type === 'null')

function fieldsOf(schema: z.ZodType): Field[] {
  const json = z.toJSONSchema(schema, {
    io: 'output',
    unrepresentable: 'any',
    // Dates are sent as ISO strings
    override: (ctx) => {
      if (ctx.zodSchema._zod.def.type === 'date') Object.assign(ctx.jsonSchema, { type: 'string', format: 'date-time' })
    },
  }) as JsonSchema
  return Object.entries(json.properties ?? {}).map(([name, s]) => ({ name, type: typeOf(s), nullable: isNullable(s) }))
}

// A payload schema shared by several topics is listed once
const payloadNames = new Map<z.ZodType, string>()
const payloads: Record<string, { fields: Field[] }> = {}
const topics = WEBHOOK_TOPICS.map((topic) => {
  const schema = webhookPayloads[topic]
  let name = payloadNames.get(schema)
  if (!name) {
    name = topic.split('.')[0]!
    payloadNames.set(schema, name)
    payloads[name] = { fields: fieldsOf(schema) }
  }
  return { topic, description: WEBHOOK_TOPIC_DESCRIPTIONS[topic], payload: name }
})

const formatSeconds = (s: number) => (s >= 3600 ? `${s / 3600}h` : `${s / 60}m`)

const reference = {
  scopes: API_SCOPES.map((scope) => ({ scope, description: API_SCOPE_DESCRIPTIONS[scope] })),
  webhooks: {
    testTopic: WEBHOOK_TEST_TOPIC,
    topics,
    payloads,
    retrySchedule: RETRY_DELAYS_S.map(formatSeconds),
    timeoutSeconds: TIMEOUT_MS / 1000,
    retentionDays: RETENTION_MS / (24 * 3600_000),
  },
}

await mkdir('generated', { recursive: true })
await writeFile('generated/reference.json', JSON.stringify(reference, null, 2) + '\n')
console.log(`Wrote generated/reference.json (${reference.scopes.length} scopes, ${topics.length} webhook topics)`)

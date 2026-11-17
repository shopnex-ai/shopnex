// The shapes of this module's API: what the admin routes accept and answer. Plain Zod, no oRPC or server code, so the
// admin UI uses the same schemas for its forms (re-exported by @shopnex/api/schemas).
import { createSelectSchema } from 'drizzle-zod'
import { z } from 'zod'
import { S3_PRESETS, files } from './files.schema'

// Settings → Storage: an S3-compatible bucket (AWS S3, Cloudflare R2, Spaces, B2, MinIO…)
const httpUrl = z.url({ protocol: /^https?$/ }).max(500)
export const s3Input = z.object({
  preset: z.enum(S3_PRESETS),
  endpoint: httpUrl,
  region: z.string().trim().min(1).max(64),
  bucket: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9][A-Za-z0-9._-]{1,62}$/, 'Use the bucket name exactly as your provider shows it'),
  accessKeyId: z.string().trim().min(1).max(256),
  // Optional when a key is already saved: leaving it empty keeps that one
  secretAccessKey: z.string().trim().max(512).optional(),
  publicUrl: httpUrl,
  forcePathStyle: z.boolean(),
  publicAcl: z.boolean(),
})

export const storageInput = z.discriminatedUnion('provider', [
  z.object({ provider: z.literal('local') }),
  z.object({ provider: z.literal('s3'), s3: s3Input }),
])

export const storageSettingsOutput = z.object({
  provider: z.enum(['s3', 'local']),
  s3: z
    .object({
      hasSecret: z.boolean(),
      preset: z.enum(S3_PRESETS),
      endpoint: z.string(),
      region: z.string(),
      bucket: z.string(),
      accessKeyId: z.string(),
      publicUrl: z.string(),
      forcePathStyle: z.boolean(),
      publicAcl: z.boolean().optional(),
    })
    .nullable(),
})
export const fileOutput = createSelectSchema(files).extend({ url: z.string() })
export const fileListOutput = z.object({ items: z.array(fileOutput), total: z.number().int() })

// What the connection test answers: one entry per step it ran
export const storageTestOutput = z.object({
  ok: z.boolean(),
  steps: z.array(z.object({ step: z.string(), ok: z.boolean(), error: z.string().optional() })),
})

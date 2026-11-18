// The shapes of this module's API: what the Settings → Email and Settings → Notifications routes take and answer. Plain Zod, no oRPC or
// server code (the admin imports the inputs for form validation).
import { createSelectSchema } from 'drizzle-zod'
import { z } from 'zod'
import { NOTIFICATIONS, SMTP_PRESETS, emailDeliveries } from './email.schema'

export const smtpInput = z.object({
  preset: z.enum(SMTP_PRESETS),
  host: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9]([A-Za-z0-9.-]{0,251}[A-Za-z0-9])?$/, 'Host name only, like smtp.example.com'),
  port: z.number().int().min(1).max(65535),
  // Empty = no login (a local relay)
  username: z.string().trim().max(256),
  // Optional when one is already saved: leaving it empty keeps that one. Not trimmed: spaces can be part of it
  password: z.string().max(512).optional(),
  fromName: z.string().trim().max(100),
  fromEmail: z.email('Enter an email address'),
})

export const notificationParam = z.object({ notification: z.enum(NOTIFICATIONS) })

// How long a checkout with an email sits untouched before the reminder (the service enforces the limits)
export const abandonedCartSettingsInput = z.object({
  enabled: z.boolean().optional(),
  delayMinutes: z.number().int().optional(),
})

// Liquid source; syntax is checked by the email service (with the line of the error)
export const templateInput = z.object({
  subject: z.string().max(500),
  body: z.string().max(200_000),
})

// Turning a notification on/off and editing it are the same request
export const templatePatchInput = templateInput.partial().extend({ enabled: z.boolean().optional() })

export const emailInput = z.discriminatedUnion('provider', [
  z.object({ provider: z.literal('off') }),
  z.object({ provider: z.literal('smtp'), smtp: smtpInput }),
])

// ── what the routes answer

const testSteps = z.array(z.object({ step: z.string(), ok: z.boolean(), error: z.string().optional() }))
export const testResultOutput = z.object({ ok: z.boolean(), steps: testSteps })
export const emailSettingsOutput = z.object({
  provider: z.enum(['off', 'smtp']),
  smtp: z
    .object({
      hasPassword: z.boolean(),
      preset: z.enum(SMTP_PRESETS),
      host: z.string(),
      port: z.number().int(),
      username: z.string(),
      fromName: z.string(),
      fromEmail: z.string(),
    })
    .nullable(),
})
const notificationBase = {
  enabled: z.boolean(),
  customized: z.boolean(),
  notification: z.enum(NOTIFICATIONS),
  title: z.string(),
  description: z.string(),
  audience: z.enum(['customer', 'staff', 'layout']),
}
export const notificationListItemOutput = z.object(notificationBase)
export const notificationOutput = z.object({
  ...notificationBase,
  subject: z.string(),
  body: z.string(),
  defaults: z.object({ subject: z.string(), body: z.string() }),
})
export const notificationDeliveryOutput = createSelectSchema(emailDeliveries, {
  notification: z.enum(NOTIFICATIONS),
  status: z.enum(['pending', 'failed', 'sent', 'skipped']),
}).pick({
  id: true,
  notification: true,
  orderId: true,
  to: true,
  subject: true,
  status: true,
  attempts: true,
  lastError: true,
  createdAt: true,
})
export const abandonedCartSettingsOutput = z.object({
  enabled: z.boolean(),
  delayMinutes: z.number().int(),
  /** Reminders can only go out when the shop sends email (Settings → Email) */
  emailOn: z.boolean(),
})
export const notificationPreviewOutput = z.object({
  sample: z.boolean(),
  subject: z.string(),
  html: z.string(),
  problem: z.object({ message: z.string(), line: z.number().int().nullable() }).nullable(),
})
export const notificationTestOutput = z.object({ to: z.string() })

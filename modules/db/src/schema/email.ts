// How a shop sends email (Settings → Email): any SMTP server. Off by default; messages are then only logged.
import { sql } from 'drizzle-orm'
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import { orders } from './orders'
import { shops } from './tenancy'

// Presets only prefill the form; every provider is configured the same way (all of them offer SMTP)
export const SMTP_PRESETS = ['resend', 'postmark', 'sendgrid', 'mailgun', 'ses', 'brevo', 'gmail', 'other'] as const
export type SmtpPreset = (typeof SMTP_PRESETS)[number]

export type SmtpConfig = {
  preset: SmtpPreset
  host: string
  /** 465 = TLS from the start; anything else upgrades with STARTTLS (required when logging in) */
  port: number
  /** Empty = no login (a local relay or Mailpit) */
  username: string
  fromName: string
  fromEmail: string
}

export const emailSettings = pgTable('email_settings', {
  shopId: text('shop_id')
    .primaryKey()
    .references(() => shops.id, { onDelete: 'cascade' }),
  config: jsonb('config').$type<SmtpConfig>().notNull(),
  // AES-256-GCM, keyed from BETTER_AUTH_SECRET (see @shopnex/db/secrets); null without a login
  password: text('password'),
  // Off keeps the setup, so switching back on doesn't mean typing it again
  active: boolean('active').notNull().default(false),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

export type EmailSettings = typeof emailSettings.$inferSelect

// Emails Shopnex sends by itself (Settings → Notifications). `layout` wraps every other one (header, footer).
export const NOTIFICATIONS = [
  'order_confirmation',
  'shipping_confirmation',
  'order_cancelled',
  'staff_order',
  'login_code',
  'layout',
] as const
export type Notification = (typeof NOTIFICATIONS)[number]

// A shop's edits to a notification's Liquid. No row, or null subject/body = the built-in default.
export const emailTemplates = pgTable(
  'email_templates',
  {
    shopId: text('shop_id')
      .notNull()
      .references(() => shops.id, { onDelete: 'cascade' }),
    notification: text('notification').$type<Notification>().notNull(),
    subject: text('subject'),
    body: text('body'),
    enabled: boolean('enabled').notNull().default(true),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.shopId, t.notification] })],
)

export type EmailTemplate = typeof emailTemplates.$inferSelect

export const EMAIL_DELIVERY_STATUSES = ['pending', 'sent', 'failed', 'skipped'] as const
export type EmailDeliveryStatus = (typeof EMAIL_DELIVERY_STATUSES)[number]

// Outbox: queued in the transaction that changed the order, rendered then (a snapshot), sent by the worker.
// timestamptz: the worker compares these with JS dates, like webhook deliveries.
export const emailDeliveries = pgTable(
  'email_deliveries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    shopId: text('shop_id')
      .notNull()
      .references(() => shops.id, { onDelete: 'cascade' }),
    notification: text('notification').$type<Notification>().notNull(),
    orderId: uuid('order_id').references(() => orders.id, { onDelete: 'cascade' }),
    to: text('to').notNull(),
    subject: text('subject').notNull(),
    html: text('html').notNull(),
    status: text('status').$type<EmailDeliveryStatus>().notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }).notNull().defaultNow(),
    lastAttemptAt: timestamp('last_attempt_at', { withTimezone: true }),
    lastError: text('last_error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('email_deliveries_due_idx').on(t.status, t.nextAttemptAt),
    index('email_deliveries_shop_created_idx').on(t.shopId, t.createdAt),
    // Each order gets a notification once per recipient, however often its event fires
    uniqueIndex('email_deliveries_order_once_idx')
      .on(t.orderId, t.notification, t.to)
      .where(sql`${t.orderId} is not null`),
  ],
)

export type EmailDelivery = typeof emailDeliveries.$inferSelect

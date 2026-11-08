import { index, integer, pgTable, text, timestamp } from 'drizzle-orm/pg-core'

// Counters for rate limits, kept in the database so every server process shares them and a restart doesn't clear them
// (login codes: modules/auth/src/rate-limit.ts). One fixed window per key. The key is a hash: no email address or
// visitor address is stored here.
export const rateLimits = pgTable(
  'rate_limits',
  {
    key: text('key').primaryKey(),
    count: integer('count').notNull(),
    // When the window ends and the count starts again. Database clock, so replicas can't disagree.
    resetAt: timestamp('reset_at', { withTimezone: true }).notNull(),
  },
  (t) => [index('rate_limits_reset_idx').on(t.resetAt)],
)

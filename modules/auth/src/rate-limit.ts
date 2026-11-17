// A rate limiter whose counters live in the database (rate_limits), so every server process shares them and a restart
// doesn't clear them. In-memory counters, like signup-limit.ts, are per process: with several replicas the real limit
// is the cap times the number of replicas, and a restart gives everyone a fresh allowance.
import { createHash } from 'node:crypto'
import { lt, sql } from 'drizzle-orm'
import { db } from '@shopnex/db'
import { rateLimits } from './auth.schema'

// Keys name an email address or a visitor address: store only a hash, so this table holds neither
const id = (key: string) => createHash('sha256').update(key).digest('hex')

// Deliberately on the shared `db`, never a caller's transaction: a counter has to survive when the caller's work is rolled
// back (a refused login code must still count), so this takes no `conn`.
/**
 * Counts one use of `key` in a fixed window of `windowMs` that starts with its first use, shared by every process.
 * One statement, so concurrent callers can't both slip under the cap. Returns null while the use is within `max`,
 * otherwise the seconds until the window ends. Uses past the cap are counted too but never extend the window.
 */
export async function takeRate(key: string, max: number, windowMs: number): Promise<number | null> {
  const windowS = Math.max(1, Math.ceil(windowMs / 1000))
  const [row] = await db
    .insert(rateLimits)
    .values({ key: id(key), count: 1, resetAt: sql`now() + make_interval(secs => ${windowS})` })
    .onConflictDoUpdate({
      target: rateLimits.key,
      set: {
        // A finished window starts again at 1; an open one counts up and keeps its end
        count: sql`case when ${rateLimits.resetAt} <= now() then 1 else ${rateLimits.count} + 1 end`,
        resetAt: sql`case when ${rateLimits.resetAt} <= now() then now() + make_interval(secs => ${windowS}) else ${rateLimits.resetAt} end`,
      },
    })
    .returning({
      count: rateLimits.count,
      waitS: sql<number>`greatest(1, ceil(extract(epoch from (${rateLimits.resetAt} - now()))))::int`,
    })
  // Windows that ended long ago are dead weight: sweep them now and then (any process may, it is idempotent)
  if (Math.random() < 0.02) {
    void db
      .delete(rateLimits)
      .where(lt(rateLimits.resetAt, sql`now() - interval '1 hour'`))
      .catch(() => undefined)
  }
  if (!row) throw new Error('rate limit upsert returned no row')
  return row.count <= max ? null : row.waitS
}

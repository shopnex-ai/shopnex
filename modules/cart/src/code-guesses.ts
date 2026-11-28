// Guessing codes at checkout (gift cards and discount codes share one counter): failed guesses are counted per visitor address
// (in the database, so every process shares them) and a visitor that has used them up is refused before any code is looked up, so a
// lucky guess is refused too. Without a trusted address the limit is the shop's. Never call these with a transaction open: the
// counters use the shared connection.
import { rateLeft, takeRate } from '@shopnex/auth'

const WINDOW_MS = 15 * 60_000
const PER_IP = 10
const PER_SHOP = 100

export const TOO_MANY_GUESSES = 'Too many attempts. Wait a few minutes and try again.'

const key = (shopId: string, ip: string | null) => (ip ? `gift-card-miss:${shopId}:${ip}` : `gift-card-miss:${shopId}`)

/** Whether this visitor has used up their failed guesses */
export async function usedUp(shopId: string, ip: string | null): Promise<boolean> {
  return (await rateLeft(key(shopId, ip), ip ? PER_IP : PER_SHOP)) !== null
}

/** A code that named nothing: counts against this visitor */
export async function recordMiss(shopId: string, ip: string | null) {
  await takeRate(key(shopId, ip), ip ? PER_IP : PER_SHOP, WINDOW_MS)
}

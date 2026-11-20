// The app's data access: review requests and reviews, on the app's Postgres schema (see schema.ts). Every method is
// scoped to a shop of an instance where it matters, so one shop never sees or changes another's rows.
import { randomBytes, randomUUID } from 'node:crypto'
import { and, asc, desc, eq, isNull, lte, sql } from 'drizzle-orm'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import { reviewRequests, reviews } from './schema'

export type ShopKey = { instance: string; shopId: string }
export type ReviewStatus = 'pending' | 'published' | 'hidden'

export type Review = {
  id: string
  productId: string
  productTitle: string
  rating: number
  title: string
  body: string
  author: string
  verified: boolean
  status: ReviewStatus
  /** The shop's answer, shown under the review */
  reply: string | null
  createdAt: number
}

/** Which new reviews go live without waiting for the shop: none, only 4 and 5 stars, or all */
export type AutoPublish = 'off' | 'positive' | 'all'

export type ReviewRequest = {
  token: string
  instance: string
  shopId: string
  productId: string
  productTitle: string
  email: string
  sendAfter: number
}

export type ReviewInput = { rating?: unknown; title?: unknown; body?: unknown; author?: unknown }

export class ReviewError extends Error {
  constructor(
    readonly code: 'INVALID_LINK' | 'ALREADY_REVIEWED' | 'INVALID_REVIEW',
    message: string,
  ) {
    super(message)
  }
}

/** Product ids can arrive as `gid://…/Product/<uuid>` (a theme) or the bare uuid (the API): keep the last part */
export const productKey = (id: string) => id.trim().split('/').pop() ?? ''

const clean = (value: unknown, max: number) => (typeof value === 'string' ? value.trim().slice(0, max) : '')

const ofShop = (shop: ShopKey) => and(eq(reviews.instance, shop.instance), eq(reviews.shopId, shop.shopId))

export function openStore(db: NodePgDatabase) {
  const toReview = (r: typeof reviews.$inferSelect): Review => ({
    id: r.id,
    productId: r.productId,
    productTitle: r.productTitle,
    rating: r.rating,
    title: r.title,
    body: r.body,
    author: r.author,
    verified: r.verified,
    status: r.status as ReviewStatus,
    reply: r.reply,
    createdAt: r.createdAt,
  })

  return {
    /** One request per product in a fulfilled order (a webhook retry makes none). Returns the new ones. */
    async addRequests(
      shop: ShopKey,
      order: { id: string; email: string; items: { productId: string | null; title: string }[] },
      sendAfter: number,
    ): Promise<ReviewRequest[]> {
      const created: ReviewRequest[] = []
      const seen = new Set<string>()
      for (const item of order.items) {
        if (!item.productId || seen.has(item.productId)) continue
        seen.add(item.productId)
        const request: ReviewRequest = {
          token: randomBytes(24).toString('base64url'),
          instance: shop.instance,
          shopId: shop.shopId,
          productId: productKey(item.productId),
          productTitle: item.title,
          email: order.email,
          sendAfter,
        }
        const inserted = await db
          .insert(reviewRequests)
          .values({ ...request, orderId: order.id, createdAt: Date.now() })
          .onConflictDoNothing()
          .returning({ token: reviewRequests.token })
        if (inserted.length) created.push(request)
      }
      return created
    },

    /** Requests whose time has come and that were not sent yet */
    async due(now: number): Promise<ReviewRequest[]> {
      const rows = await db
        .select()
        .from(reviewRequests)
        .where(and(isNull(reviewRequests.sentAt), isNull(reviewRequests.usedAt), lte(reviewRequests.sendAfter, now)))
        .orderBy(asc(reviewRequests.sendAfter))
        .limit(100)
      return rows.map((r) => ({
        token: r.token,
        instance: r.instance,
        shopId: r.shopId,
        productId: r.productId,
        productTitle: r.productTitle,
        email: r.email,
        sendAfter: r.sendAfter,
      }))
    },

    async markSent(token: string, now: number) {
      await db.update(reviewRequests).set({ sentAt: now }).where(eq(reviewRequests.token, token))
    },

    /** What the review page shows for a link; null when it is unknown or already used */
    async openRequest(token: string) {
      const [row] = await db
        .select({
          productTitle: reviewRequests.productTitle,
          instance: reviewRequests.instance,
          shopId: reviewRequests.shopId,
          usedAt: reviewRequests.usedAt,
        })
        .from(reviewRequests)
        .where(eq(reviewRequests.token, token))
      return row && row.usedAt === null
        ? { productTitle: row.productTitle, instance: row.instance, shopId: row.shopId }
        : null
    },

    /** A review from a link: single use, held for moderation (unless auto-publish lets it through), and verified because the link went to a buyer */
    async submit(token: string, input: ReviewInput, autoPublish: AutoPublish = 'off'): Promise<Review> {
      const rating = Number(input.rating)
      const body = clean(input.body, 5000)
      if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
        throw new ReviewError('INVALID_REVIEW', 'Choose a rating from 1 to 5')
      }
      if (!body) throw new ReviewError('INVALID_REVIEW', 'Write a few words about the product')
      // The link row is locked while the review is made, so two submissions of one link can't both go through
      return db.transaction(async (tx) => {
        const [request] = await tx.select().from(reviewRequests).where(eq(reviewRequests.token, token)).for('update')
        if (!request) throw new ReviewError('INVALID_LINK', 'This review link is not valid')
        if (request.usedAt !== null) throw new ReviewError('ALREADY_REVIEWED', 'You already reviewed this product')
        const [row] = await tx
          .insert(reviews)
          .values({
            id: randomUUID(),
            instance: request.instance,
            shopId: request.shopId,
            token,
            productId: request.productId,
            productTitle: request.productTitle,
            rating,
            title: clean(input.title, 120),
            body,
            author: clean(input.author, 80) || 'Anonymous',
            verified: true,
            status: autoPublish === 'all' || (autoPublish === 'positive' && rating >= 4) ? 'published' : 'pending',
            createdAt: Date.now(),
          })
          .returning()
        await tx.update(reviewRequests).set({ usedAt: Date.now() }).where(eq(reviewRequests.token, token))
        return toReview(row!)
      })
    },

    /** Moderation list for one shop, newest first */
    async list(shop: ShopKey, status?: ReviewStatus, limit = 100): Promise<Review[]> {
      const rows = await db
        .select()
        .from(reviews)
        .where(and(ofShop(shop), status ? eq(reviews.status, status) : undefined))
        .orderBy(desc(reviews.createdAt))
        .limit(limit)
      return rows.map(toReview)
    },

    /** Only within the shop: a review id from another shop changes nothing */
    async setStatus(shop: ShopKey, id: string, status: ReviewStatus) {
      const changed = await db
        .update(reviews)
        .set({ status })
        .where(and(eq(reviews.id, id), ofShop(shop)))
        .returning({ id: reviews.id })
      return changed.length > 0
    },

    /** Only within the shop. An empty reply removes the shop's answer. */
    async setReply(shop: ShopKey, id: string, reply: string) {
      const text = clean(reply, 2000)
      const changed = await db
        .update(reviews)
        .set({ reply: text || null, repliedAt: text ? Date.now() : null })
        .where(and(eq(reviews.id, id), ofShop(shop)))
        .returning({ id: reviews.id })
      return changed.length > 0
    },

    /** Only within the shop */
    async remove(shop: ShopKey, id: string) {
      const gone = await db
        .delete(reviews)
        .where(and(eq(reviews.id, id), ofShop(shop)))
        .returning({ id: reviews.id })
      return gone.length > 0
    },

    /**
     * What the storefront widget shows: published reviews of a product, newest first (`offset` pages through them),
     * their average and how many reviews gave each rating
     */
    async forProduct(shop: ShopKey, productId: string, { limit = 10, offset = 0 } = {}) {
      const where = and(ofShop(shop), eq(reviews.productId, productKey(productId)), eq(reviews.status, 'published'))
      const perRating = await db
        .select({ rating: reviews.rating, n: sql<number>`count(*)::int` })
        .from(reviews)
        .where(where)
        .groupBy(reviews.rating)
      const distribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } as Record<1 | 2 | 3 | 4 | 5, number>
      let count = 0
      let sum = 0
      for (const { rating, n } of perRating) {
        distribution[rating as 1 | 2 | 3 | 4 | 5] = n
        count += n
        sum += rating * n
      }
      const average = count === 0 ? null : Math.round((sum / count) * 10) / 10
      const rows = await db
        .select()
        .from(reviews)
        .where(where)
        .orderBy(desc(reviews.createdAt))
        .limit(limit)
        .offset(offset)
      return { count, average, distribution, reviews: rows.map(toReview) }
    },

    /** Requests of a shop whose time has come but that did not go out (usually: email is off) */
    async unsent(shop: ShopKey, now: number): Promise<number> {
      const [row] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(reviewRequests)
        .where(
          and(
            eq(reviewRequests.instance, shop.instance),
            eq(reviewRequests.shopId, shop.shopId),
            isNull(reviewRequests.sentAt),
            isNull(reviewRequests.usedAt),
            lte(reviewRequests.sendAfter, now),
          ),
        )
      return row!.n
    },

    async counts(shop: ShopKey) {
      const rows = await db
        .select({ status: reviews.status, n: sql<number>`count(*)::int` })
        .from(reviews)
        .where(ofShop(shop))
        .groupBy(reviews.status)
      const by = Object.fromEntries(rows.map((r) => [r.status, r.n]))
      return { pending: by.pending ?? 0, published: by.published ?? 0, hidden: by.hidden ?? 0 }
    },
  }
}

export type Store = ReturnType<typeof openStore>

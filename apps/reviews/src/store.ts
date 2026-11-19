// The app's own data (SQLite): review requests (one per fulfilled product, with a secret link) and the reviews that
// come back. Rows are scoped to a shop of an instance: this app serves many ShopNex instances.
import { randomBytes, randomUUID } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'

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
  createdAt: number
}

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

export function openStore(path: string) {
  const db = new DatabaseSync(path)
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS review_requests (
      token TEXT PRIMARY KEY,
      instance TEXT NOT NULL,
      shop_id TEXT NOT NULL,
      order_id TEXT NOT NULL,
      product_id TEXT NOT NULL,
      product_title TEXT NOT NULL,
      email TEXT NOT NULL,
      send_after INTEGER NOT NULL,
      sent_at INTEGER,
      used_at INTEGER,
      created_at INTEGER NOT NULL,
      UNIQUE (instance, shop_id, order_id, product_id)
    );
    CREATE TABLE IF NOT EXISTS reviews (
      id TEXT PRIMARY KEY,
      instance TEXT NOT NULL,
      shop_id TEXT NOT NULL,
      token TEXT NOT NULL UNIQUE,
      product_id TEXT NOT NULL,
      product_title TEXT NOT NULL,
      rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      author TEXT NOT NULL,
      verified INTEGER NOT NULL,
      status TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS reviews_product_idx ON reviews (instance, shop_id, product_id, status);
  `)

  const toReview = (r: Record<string, unknown>): Review => ({
    id: r.id as string,
    productId: r.product_id as string,
    productTitle: r.product_title as string,
    rating: r.rating as number,
    title: r.title as string,
    body: r.body as string,
    author: r.author as string,
    verified: r.verified === 1,
    status: r.status as ReviewStatus,
    createdAt: r.created_at as number,
  })

  return {
    db,

    /** One request per product in a fulfilled order (a webhook retry makes none). Returns the new ones. */
    addRequests(
      shop: ShopKey,
      order: { id: string; email: string; items: { productId: string | null; title: string }[] },
      sendAfter: number,
    ): ReviewRequest[] {
      const insert = db.prepare(
        `INSERT OR IGNORE INTO review_requests
           (token, instance, shop_id, order_id, product_id, product_title, email, send_after, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      const created: ReviewRequest[] = []
      const seen = new Set<string>()
      for (const item of order.items) {
        if (!item.productId || seen.has(item.productId)) continue
        seen.add(item.productId)
        const request = {
          token: randomBytes(24).toString('base64url'),
          instance: shop.instance,
          shopId: shop.shopId,
          productId: productKey(item.productId),
          productTitle: item.title,
          email: order.email,
          sendAfter,
        }
        const { changes } = insert.run(
          request.token,
          shop.instance,
          shop.shopId,
          order.id,
          request.productId,
          request.productTitle,
          request.email,
          sendAfter,
          Date.now(),
        )
        if (changes) created.push(request)
      }
      return created
    },

    /** Requests whose time has come and that were not sent yet */
    due(now: number): ReviewRequest[] {
      return db
        .prepare(
          `SELECT token, instance, shop_id, product_id, product_title, email, send_after FROM review_requests
           WHERE sent_at IS NULL AND used_at IS NULL AND send_after <= ? ORDER BY send_after LIMIT 100`,
        )
        .all(now)
        .map((r) => ({
          token: r.token as string,
          instance: r.instance as string,
          shopId: r.shop_id as string,
          productId: r.product_id as string,
          productTitle: r.product_title as string,
          email: r.email as string,
          sendAfter: r.send_after as number,
        }))
    },

    markSent(token: string, now: number) {
      db.prepare('UPDATE review_requests SET sent_at = ? WHERE token = ?').run(now, token)
    },

    /** What the review page shows for a link; null when it is unknown or already used */
    openRequest(token: string) {
      const row = db.prepare('SELECT product_title, used_at FROM review_requests WHERE token = ?').get(token) as
        { product_title: string; used_at: number | null } | undefined
      return row && row.used_at === null ? { productTitle: row.product_title } : null
    },

    /** A review from a link: single use, held for moderation, and verified because the link went to a buyer */
    submit(token: string, input: ReviewInput): Review {
      const rating = Number(input.rating)
      const body = clean(input.body, 5000)
      if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
        throw new ReviewError('INVALID_REVIEW', 'Choose a rating from 1 to 5')
      }
      if (!body) throw new ReviewError('INVALID_REVIEW', 'Write a few words about the product')
      db.exec('BEGIN IMMEDIATE')
      try {
        const request = db.prepare('SELECT * FROM review_requests WHERE token = ?').get(token) as
          Record<string, unknown> | undefined
        if (!request) throw new ReviewError('INVALID_LINK', 'This review link is not valid')
        if (request.used_at !== null) throw new ReviewError('ALREADY_REVIEWED', 'You already reviewed this product')
        const id = randomUUID()
        db.prepare(
          `INSERT INTO reviews
             (id, instance, shop_id, token, product_id, product_title, rating, title, body, author, verified, status, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 'pending', ?)`,
        ).run(
          id,
          request.instance as string,
          request.shop_id as string,
          token,
          request.product_id as string,
          request.product_title as string,
          rating,
          clean(input.title, 120),
          body,
          clean(input.author, 80) || 'Anonymous',
          Date.now(),
        )
        db.prepare('UPDATE review_requests SET used_at = ? WHERE token = ?').run(Date.now(), token)
        db.exec('COMMIT')
        return toReview(db.prepare('SELECT * FROM reviews WHERE id = ?').get(id) as Record<string, unknown>)
      } catch (error) {
        db.exec('ROLLBACK')
        throw error
      }
    },

    /** Moderation list for one shop, newest first */
    list(shop: ShopKey, status?: ReviewStatus, limit = 100): Review[] {
      const rows = status
        ? db
            .prepare(
              'SELECT * FROM reviews WHERE instance = ? AND shop_id = ? AND status = ? ORDER BY created_at DESC LIMIT ?',
            )
            .all(shop.instance, shop.shopId, status, limit)
        : db
            .prepare('SELECT * FROM reviews WHERE instance = ? AND shop_id = ? ORDER BY created_at DESC LIMIT ?')
            .all(shop.instance, shop.shopId, limit)
      return rows.map(toReview)
    },

    /** Only within the shop: a review id from another shop changes nothing */
    setStatus(shop: ShopKey, id: string, status: ReviewStatus) {
      const { changes } = db
        .prepare('UPDATE reviews SET status = ? WHERE id = ? AND instance = ? AND shop_id = ?')
        .run(status, id, shop.instance, shop.shopId)
      return changes > 0
    },

    /** What the storefront widget shows: published reviews of a product and their average */
    forProduct(shop: ShopKey, productId: string, limit = 20) {
      const product = productKey(productId)
      const where = "instance = ? AND shop_id = ? AND product_id = ? AND status = 'published'"
      const { count, average } = db
        .prepare(`SELECT COUNT(*) AS count, AVG(rating) AS average FROM reviews WHERE ${where}`)
        .get(shop.instance, shop.shopId, product) as { count: number; average: number | null }
      const reviews = db
        .prepare(`SELECT * FROM reviews WHERE ${where} ORDER BY created_at DESC LIMIT ?`)
        .all(shop.instance, shop.shopId, product, limit)
        .map(toReview)
      return { count, average: average === null ? null : Math.round(average * 10) / 10, reviews }
    },

    /** Requests of a shop whose time has come but that did not go out (usually: no email server set up yet) */
    unsent(shop: ShopKey, now: number): number {
      const row = db
        .prepare(
          `SELECT COUNT(*) AS n FROM review_requests
           WHERE instance = ? AND shop_id = ? AND sent_at IS NULL AND used_at IS NULL AND send_after <= ?`,
        )
        .get(shop.instance, shop.shopId, now) as { n: number }
      return row.n
    },

    counts(shop: ShopKey) {
      const rows = db
        .prepare('SELECT status, COUNT(*) AS n FROM reviews WHERE instance = ? AND shop_id = ? GROUP BY status')
        .all(shop.instance, shop.shopId) as { status: ReviewStatus; n: number }[]
      const by = Object.fromEntries(rows.map((r) => [r.status, r.n]))
      return { pending: by.pending ?? 0, published: by.published ?? 0, hidden: by.hidden ?? 0 }
    },
  }
}

export type Store = ReturnType<typeof openStore>

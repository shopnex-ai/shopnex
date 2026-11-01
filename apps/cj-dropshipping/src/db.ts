// What the app remembers beyond per-shop settings: which Shopnex variant is which CJ variant, and what happened
// to each order it forwarded. Lives in the app's SQLite database (shop data is capped at 100 keys).
import type { DatabaseSync } from 'node:sqlite'
import type { ShopContext } from '@shopnex/app'

export type OrderStatus = 'pending' | 'created' | 'fulfilled' | 'failed'

export type ForwardedOrder = {
  orderId: string
  orderNumber: number
  cjOrderId: string | null
  status: OrderStatus
  error: string | null
  trackingNumber: string | null
  createdAt: string
}

export function openTables(db: DatabaseSync) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS cj_variants (
      instance TEXT NOT NULL, shop_id TEXT NOT NULL, sku TEXT NOT NULL, pid TEXT NOT NULL, vid TEXT NOT NULL,
      PRIMARY KEY (instance, shop_id, sku)
    );
    CREATE TABLE IF NOT EXISTS cj_product_status (
      instance TEXT NOT NULL, shop_id TEXT NOT NULL, pid TEXT NOT NULL, available INTEGER NOT NULL,
      checked_at INTEGER NOT NULL,
      PRIMARY KEY (instance, shop_id, pid)
    );
    CREATE TABLE IF NOT EXISTS cj_orders (
      instance TEXT NOT NULL, shop_id TEXT NOT NULL, order_id TEXT NOT NULL, order_number INTEGER NOT NULL,
      cj_order_id TEXT, status TEXT NOT NULL, error TEXT, tracking_number TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (instance, shop_id, order_id)
    );
  `)
  const saveVariant = db.prepare('INSERT OR REPLACE INTO cj_variants VALUES (?, ?, ?, ?, ?)')
  const findVariant = db.prepare('SELECT pid, vid FROM cj_variants WHERE instance = ? AND shop_id = ? AND sku = ?')
  const linked = db.prepare('SELECT pid, sku FROM cj_variants WHERE instance = ? AND shop_id = ?')
  const saveStatus = db.prepare('INSERT OR REPLACE INTO cj_product_status VALUES (?, ?, ?, ?, ?)')
  const statuses = db.prepare(
    'SELECT pid, available, checked_at FROM cj_product_status WHERE instance = ? AND shop_id = ?',
  )
  const claim = db.prepare(
    "INSERT INTO cj_orders (instance, shop_id, order_id, order_number, status) VALUES (?, ?, ?, ?, 'pending') ON CONFLICT DO NOTHING",
  )
  const retry = db.prepare(
    "UPDATE cj_orders SET status = 'pending', error = NULL WHERE instance = ? AND shop_id = ? AND order_id = ? AND status = 'failed'",
  )
  const update = db.prepare(
    'UPDATE cj_orders SET status = ?, error = ?, cj_order_id = coalesce(?, cj_order_id), tracking_number = coalesce(?, tracking_number) WHERE instance = ? AND shop_id = ? AND order_id = ?',
  )
  const drop = db.prepare('DELETE FROM cj_orders WHERE instance = ? AND shop_id = ? AND order_id = ?')
  const list = db.prepare(
    'SELECT order_id, order_number, cj_order_id, status, error, tracking_number, created_at FROM cj_orders WHERE instance = ? AND shop_id = ? ORDER BY order_number DESC LIMIT ?',
  )
  const open = db.prepare(
    "SELECT order_id, cj_order_id FROM cj_orders WHERE instance = ? AND shop_id = ? AND status = 'created'",
  )
  const shops = db.prepare("SELECT DISTINCT instance, shop_id FROM cj_orders WHERE status = 'created'")

  return {
    saveVariant: (s: ShopContext, sku: string, pid: string, vid: string) =>
      void saveVariant.run(s.instance, s.shopId, sku, pid, vid),
    findVariant: (s: ShopContext, sku: string) =>
      findVariant.get(s.instance, s.shopId, sku) as { pid: string; vid: string } | undefined,
    /** The shop SKUs the app has tied to each CJ product (imported or linked) */
    linkedSkus: (s: ShopContext) => {
      const byPid = new Map<string, string[]>()
      for (const r of linked.all(s.instance, s.shopId) as { pid: string; sku: string }[]) {
        byPid.set(r.pid, [...(byPid.get(r.pid) ?? []), r.sku])
      }
      return byPid
    },
    /** Whether CJ still sells a product (checked when listing, or learned when an import fails) */
    setAvailable: (s: ShopContext, pid: string, available: boolean) =>
      void saveStatus.run(s.instance, s.shopId, pid, available ? 1 : 0, Date.now()),
    availability: (s: ShopContext) =>
      new Map(
        (statuses.all(s.instance, s.shopId) as { pid: string; available: number; checked_at: number }[]).map((r) => [
          r.pid,
          { available: r.available === 1, checkedAt: r.checked_at },
        ]),
      ),
    /** True when this call took the order: false when it is already being (or has been) forwarded */
    claimOrder: (s: ShopContext, orderId: string, orderNumber: number) =>
      // A failed order is picked up again; a new one is recorded; anything else is already handled
      Number(retry.run(s.instance, s.shopId, orderId).changes) === 1 ||
      Number(claim.run(s.instance, s.shopId, orderId, orderNumber).changes) === 1,
    setOrder: (
      s: ShopContext,
      orderId: string,
      status: OrderStatus,
      fields: { error?: string; cjOrderId?: string; trackingNumber?: string } = {},
    ) =>
      void update.run(
        status,
        fields.error ?? null,
        fields.cjOrderId ?? null,
        fields.trackingNumber ?? null,
        s.instance,
        s.shopId,
        orderId,
      ),
    dropOrder: (s: ShopContext, orderId: string) => void drop.run(s.instance, s.shopId, orderId),
    orders: (s: ShopContext, limit = 25): ForwardedOrder[] =>
      (list.all(s.instance, s.shopId, limit) as Record<string, any>[]).map((r) => ({
        orderId: r.order_id,
        orderNumber: r.order_number,
        cjOrderId: r.cj_order_id,
        status: r.status,
        error: r.error,
        trackingNumber: r.tracking_number,
        createdAt: r.created_at,
      })),
    awaitingTracking: (s: ShopContext) => open.all(s.instance, s.shopId) as { order_id: string; cj_order_id: string }[],
    shopsAwaitingTracking: () => shops.all() as { instance: string; shop_id: string }[],
  }
}

export type Tables = ReturnType<typeof openTables>

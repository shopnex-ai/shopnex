# Webhooks

Settings → Webhooks (owners/admins): add a URL, pick events, send a test, see deliveries and redeliver.

- Topics: `order.created|paid|fulfilled|cancelled|updated`, `product.created|updated`, `inventory.updated`, `customer.created|updated` (`webhook.test` from the admin)
- Body: `{ type, timestamp, shopId, data }`; `data` is the resource as the admin API returns it, snapshotted when the event happened
- Signed per [Standard Webhooks](https://www.standardwebhooks.com): `webhook-id` (same on retries — dedupe on it), `webhook-timestamp`, `webhook-signature`; verify with any of its libraries and the endpoint's `whsec_…` secret
- Outbox: services call `emit(tx, …)` inside their transaction, so a rolled-back change sends nothing
- Worker: started by `apps/admin-ui/src/server.ts`, polls every 3s, claims rows with `SKIP LOCKED` (safe with several instances). Non-2xx/timeout (10s) → retried after 1m, 5m, 30m, 2h, 5h, 8h, 8h, then failed. Finished deliveries are kept 30 days
- Delivery order isn't guaranteed: use `data.updatedAt`. Stock changes from checkout don't emit `product.updated`: subscribe to `inventory.updated` (`{ variantId, productId, sku, inventoryQuantity, change, reason: order|restock|edit, updatedAt }`, needs `read_products`). Replacing a product's variants emits `product.updated` only
- Multi-tenant mode blocks endpoints on private/loopback addresses (SSRF); single mode allows them (e.g. n8n on localhost)
- Payload contract: `e2e/tests/webhook-payloads.test.ts` checks a real payload of every topic against `webhookPayloads` and the field snapshot in `webhook-payloads.snapshot.json`. Adding a field is allowed: rerun with `WEBHOOK_SNAPSHOT=update pnpm e2e` and commit the snapshot. Removing or renaming one fails the test, since apps read these fields

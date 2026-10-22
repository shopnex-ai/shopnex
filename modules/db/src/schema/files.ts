// Files the merchant uploads (product images today). The bytes live in a storage backend: the server's
// disk, or an S3-compatible bucket the shop configures (Settings → Storage). Each file remembers the
// backend that holds it, so switching backends later doesn't strand files uploaded before.
import { sql } from 'drizzle-orm'
import { boolean, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
import { shops } from './tenancy'

// Presets only prefill the form; every S3-compatible service is configured the same way
export const S3_PRESETS = ['aws', 'r2', 'spaces', 'b2', 'minio', 'other'] as const
export type S3Preset = (typeof S3_PRESETS)[number]

export type S3Config = {
  preset: S3Preset
  /** API endpoint, e.g. https://<account-id>.r2.cloudflarestorage.com */
  endpoint: string
  region: string
  bucket: string
  accessKeyId: string
  /** Public base URL files are served from (bucket's public domain or a CDN); keys are appended to it */
  publicUrl: string
  /** {endpoint}/{bucket}/{key} instead of {bucket}.{endpoint host}/{key} (MinIO and most self-hosted) */
  forcePathStyle: boolean
  /** Send x-amz-acl: public-read on upload, for services that make objects public one by one (Spaces).
   *  Off for buckets with ACLs disabled (AWS default, R2), which reject it. */
  publicAcl?: boolean
}

// An S3-compatible bucket a shop has configured. The active one receives new uploads; a row whose bucket
// or public URL changed is replaced rather than edited, so files keep pointing at where they really are.
export const storageBackends = pgTable(
  'storage_backends',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    shopId: text('shop_id')
      .notNull()
      .references(() => shops.id, { onDelete: 'cascade' }),
    config: jsonb('config').$type<S3Config>().notNull(),
    // AES-256-GCM, keyed from BETTER_AUTH_SECRET (see @shopnex/files secrets)
    secretAccessKey: text('secret_access_key').notNull(),
    // No active row = new uploads go to the server's disk
    active: boolean('active').notNull().default(false),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('storage_backends_shop_active_idx')
      .on(t.shopId)
      .where(sql`${t.active}`),
  ],
)

export type StorageBackend = typeof storageBackends.$inferSelect

export const files = pgTable(
  'files',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    shopId: text('shop_id')
      .notNull()
      .references(() => shops.id, { onDelete: 'cascade' }),
    // Backend that holds the bytes: 'local' (the server's disk) or a storage_backends id
    storage: text('storage').notNull(),
    // Object key within that storage: {shopId}/{random}.{ext}
    key: text('key').notNull(),
    // Original name, for display only
    filename: text('filename').notNull(),
    // Sniffed from the bytes, not trusted from the client
    mimeType: text('mime_type').notNull(),
    size: integer('size').notNull(),
    alt: text('alt'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('files_storage_key_idx').on(t.storage, t.key),
    index('files_shop_created_idx').on(t.shopId, t.createdAt),
  ],
)

export type StoredFile = typeof files.$inferSelect

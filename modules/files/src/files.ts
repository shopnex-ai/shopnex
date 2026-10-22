// The shop's file library (uploaded images). Business logic only; every query is scoped by shopId.
import { randomUUID } from 'node:crypto'
import { and, count as countFn, desc, eq } from 'drizzle-orm'
import { db, schema, type Conn } from '@shopnex/db'
import type { StoredFile } from '@shopnex/db/schema'
import { FilesError } from './errors'
import { IMAGE_TYPES, sniffImage } from './sniff'
import { activeStorage, providersFor } from './backends'

export const MAX_FILE_SIZE = 20 * 1024 * 1024

export type FileWithUrl = StoredFile & { url: string }

// Rows of one shop, with the URL their backend serves them at
async function withUrls(shopId: string, rows: StoredFile[]): Promise<FileWithUrl[]> {
  const providers = await providersFor(
    shopId,
    rows.map((r) => r.storage),
  )
  return rows.map((row) => ({ ...row, url: providers.get(row.storage)!.url(row.key) }))
}

export async function list(shopId: string, opts: { limit: number; offset: number }, conn: Conn = db) {
  const rows = await conn
    .select()
    .from(schema.files)
    .where(eq(schema.files.shopId, shopId))
    .orderBy(desc(schema.files.createdAt))
    .limit(opts.limit)
    .offset(opts.offset)
  return withUrls(shopId, rows)
}

export async function count(shopId: string, conn: Conn = db) {
  const [row] = await conn.select({ n: countFn() }).from(schema.files).where(eq(schema.files.shopId, shopId))
  return row?.n ?? 0
}

export async function upload(shopId: string, file: File, opts: { alt?: string | null } = {}) {
  if (file.size > MAX_FILE_SIZE) {
    throw new FilesError('FILE_TOO_LARGE', `Files can be up to ${MAX_FILE_SIZE / 1024 / 1024} MB`)
  }
  const bytes = new Uint8Array(await file.arrayBuffer())
  const mimeType = sniffImage(bytes)
  if (!mimeType) throw new FilesError('UNSUPPORTED_TYPE', 'Upload a JPEG, PNG, GIF, WebP or AVIF image')

  const storage = await activeStorage(shopId)
  const key = `${shopId}/${randomUUID()}.${IMAGE_TYPES[mimeType]}`
  await storage.put(key, bytes, mimeType)
  try {
    const [row] = await db
      .insert(schema.files)
      .values({
        shopId,
        storage: storage.name,
        key,
        filename: file.name.slice(0, 255) || 'upload',
        mimeType,
        size: bytes.byteLength,
        alt: opts.alt ?? null,
      })
      .returning()
    return { ...row!, url: storage.url(key) }
  } catch (error) {
    await storage.delete(key).catch(() => {})
    throw error
  }
}

// Removes the bytes too. Products still pointing at the URL show a broken image.
export async function remove(shopId: string, id: string) {
  const [row] = await db
    .delete(schema.files)
    .where(and(eq(schema.files.shopId, shopId), eq(schema.files.id, id)))
    .returning()
  if (!row) return null
  const provider = (await providersFor(shopId, [row.storage])).get(row.storage)!
  await provider.delete(row.key)
  return { ...row, url: provider.url(row.key) }
}

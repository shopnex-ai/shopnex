// The shop's file library (uploaded images). Business logic only; every query is scoped by shopId.
import { randomUUID } from 'node:crypto'
import { and, count as countFn, desc, eq } from 'drizzle-orm'
import { schema, type Conn } from '@shopnex/db'
import type { StoredFile } from '@shopnex/db/schema'
import { FilesError } from './errors'
import { IMAGE_TYPES, sniffImage } from './sniff'
import { activeStorage, providersFor } from './backends'
import type { StorageProvider } from './storage'

export const MAX_FILE_SIZE = 20 * 1024 * 1024

export type FileWithUrl = StoredFile & { url: string }

// A file always points at a backend that exists: its row is only removed with the files that use it
function providerOf(providers: Map<string, StorageProvider>, row: StoredFile) {
  const provider = providers.get(row.storage)
  if (!provider) throw new Error(`The storage ${row.storage} of file ${row.id} is gone`)
  return provider
}

// Rows of one shop, with the URL their backend serves them at
async function withUrls(shopId: string, rows: StoredFile[], conn: Conn): Promise<FileWithUrl[]> {
  const providers = await providersFor(
    shopId,
    rows.map((r) => r.storage),
    conn,
  )
  return rows.map((row) => ({ ...row, url: providerOf(providers, row).url(row.key) }))
}

export async function list(shopId: string, opts: { limit: number; offset: number }, conn: Conn) {
  const rows = await conn
    .select()
    .from(schema.files)
    .where(eq(schema.files.shopId, shopId))
    .orderBy(desc(schema.files.createdAt))
    .limit(opts.limit)
    .offset(opts.offset)
  return withUrls(shopId, rows, conn)
}

export async function count(shopId: string, conn: Conn) {
  const [row] = await conn.select({ n: countFn() }).from(schema.files).where(eq(schema.files.shopId, shopId))
  return row?.n ?? 0
}

export async function upload(shopId: string, file: File, opts: { alt?: string | null }, conn: Conn) {
  if (file.size > MAX_FILE_SIZE) {
    throw new FilesError('FILE_TOO_LARGE', `Files can be up to ${String(MAX_FILE_SIZE / 1024 / 1024)} MB`)
  }
  const bytes = new Uint8Array(await file.arrayBuffer())
  const mimeType = sniffImage(bytes)
  if (!mimeType) throw new FilesError('UNSUPPORTED_TYPE', 'Upload a JPEG, PNG, GIF, WebP or AVIF image')

  const storage = await activeStorage(shopId, conn)
  const key = `${shopId}/${randomUUID()}.${IMAGE_TYPES[mimeType]}`
  await storage.put(key, bytes, mimeType)
  try {
    const [row] = await conn
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
    if (!row) throw new Error('The file was not saved')
    return { ...row, url: storage.url(key) }
  } catch (error) {
    await storage.delete(key).catch(() => undefined)
    throw error
  }
}

// Removes the bytes too. Products still pointing at the URL show a broken image.
export async function remove(shopId: string, id: string, conn: Conn) {
  const [row] = await conn
    .delete(schema.files)
    .where(and(eq(schema.files.shopId, shopId), eq(schema.files.id, id)))
    .returning()
  if (!row) return null
  const provider = providerOf(await providersFor(shopId, [row.storage], conn), row)
  await provider.delete(row.key)
  return { ...row, url: provider.url(row.key) }
}

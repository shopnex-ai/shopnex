// Settings → Storage: where a shop's new uploads go. The server's disk by default, or an S3-compatible
// bucket. Saving a bucket runs the connection test first, so a broken setup never receives uploads.
import { randomUUID } from 'node:crypto'
import { and, desc, eq, inArray } from 'drizzle-orm'
import { db, schema } from '@shopnex/db'
import type { S3Config, StorageBackend } from '@shopnex/db/schema'
import { decryptSecret, encryptSecret } from '@shopnex/db/secrets'
import { isMultiTenant } from '@shopnex/tenancy'
import { assertPublicHost } from '@shopnex/webhooks/network'
import { FilesError } from './errors'
import { publicFileUrl, s3Provider } from './s3'
import { localDisk, type StorageProvider } from './storage'

/** Omit secretAccessKey to keep the one already saved */
export type S3Input = S3Config & { secretAccessKey?: string }

const providerOf = (row: StorageBackend) => s3Provider(row.id, row.config, decryptSecret(row.secretAccessKey))

// Most recent bucket setup (active or not): the form starts from it after switching back to the disk
async function latest(shopId: string) {
  const [row] = await db
    .select()
    .from(schema.storageBackends)
    .where(eq(schema.storageBackends.shopId, shopId))
    .orderBy(desc(schema.storageBackends.createdAt))
    .limit(1)
  return row ?? null
}

// Never returns the secret, only whether one is saved
export async function getSettings(shopId: string) {
  const row = await latest(shopId)
  return {
    provider: row?.active ? ('s3' as const) : ('local' as const),
    s3: row ? { ...row.config, hasSecret: true } : null,
  }
}

export async function activeStorage(shopId: string): Promise<StorageProvider> {
  const [row] = await db
    .select()
    .from(schema.storageBackends)
    .where(and(eq(schema.storageBackends.shopId, shopId), eq(schema.storageBackends.active, true)))
  return row ? providerOf(row) : localDisk
}

/** Providers for the backends files point at, by file.storage */
export async function providersFor(shopId: string, names: string[]) {
  const ids = [...new Set(names)].filter((n) => n !== localDisk.name)
  const rows = ids.length
    ? await db
        .select()
        .from(schema.storageBackends)
        .where(and(eq(schema.storageBackends.shopId, shopId), inArray(schema.storageBackends.id, ids)))
    : []
  return new Map<string, StorageProvider>([
    [localDisk.name, localDisk],
    ...rows.map((r) => [r.id, providerOf(r)] as const),
  ])
}

async function secretFor(shopId: string, input: S3Input) {
  if (input.secretAccessKey) return input.secretAccessKey
  const row = await latest(shopId)
  if (!row) throw new FilesError('SECRET_REQUIRED', 'Enter the secret access key')
  return decryptSecret(row.secretAccessKey)
}

const configOf = ({ secretAccessKey: _, ...config }: S3Input): S3Config => config

export type TestStep = { step: 'upload' | 'public' | 'delete'; ok: boolean; error?: string }

const message = (error: unknown) => (error instanceof Error ? error.message : String(error))

// Uploads a small file, loads it from the public URL like a storefront would, then deletes it
export async function testS3(shopId: string, input: S3Input) {
  const config = configOf(input)
  const provider = s3Provider('test', config, await secretFor(shopId, input))
  const key = `${shopId}/shopnex-connection-test-${randomUUID()}.txt`
  const steps: TestStep[] = []
  const run = async (step: TestStep['step'], fn: () => Promise<void>) => {
    try {
      await fn()
      steps.push({ step, ok: true })
      return true
    } catch (error) {
      steps.push({ step, ok: false, error: message(error) })
      return false
    }
  }

  if (await run('upload', () => provider.put(key, new TextEncoder().encode('ok'), 'text/plain'))) {
    await run('public', async () => {
      const url = new URL(publicFileUrl(config, key))
      if (isMultiTenant) await assertPublicHost(url)
      const res = await fetch(url, {
        redirect: isMultiTenant ? 'manual' : 'follow',
        signal: AbortSignal.timeout(15_000),
      })
      if (!res.ok) throw new Error(`${url.origin} answered HTTP ${res.status}. Is public access on for this bucket?`)
    })
    await run('delete', () => provider.delete(key))
  }
  return { ok: steps.every((s) => s.ok), steps }
}

const sameLocation = (a: S3Config, b: S3Config) =>
  a.endpoint === b.endpoint &&
  a.bucket === b.bucket &&
  a.publicUrl === b.publicUrl &&
  a.forcePathStyle === b.forcePathStyle &&
  a.region === b.region

// New uploads go to this bucket. Same bucket as before (e.g. rotated keys): that row is updated; otherwise
// a new row, so files already uploaded keep the setup that matches where they are.
export async function useS3(shopId: string, input: S3Input) {
  const result = await testS3(shopId, input)
  const failed = result.steps.find((s) => !s.ok)
  if (failed) throw new FilesError('STORAGE_FAILED', `Connection test failed (${failed.step}): ${failed.error}`)

  const config = configOf(input)
  const secretAccessKey = encryptSecret(await secretFor(shopId, input))
  const previous = await latest(shopId)
  await db.transaction(async (tx) => {
    await tx
      .update(schema.storageBackends)
      .set({ active: false, updatedAt: new Date() })
      .where(and(eq(schema.storageBackends.shopId, shopId), eq(schema.storageBackends.active, true)))
    if (previous && sameLocation(previous.config, config)) {
      await tx
        .update(schema.storageBackends)
        .set({ config, secretAccessKey, active: true, updatedAt: new Date() })
        .where(eq(schema.storageBackends.id, previous.id))
    } else {
      await tx.insert(schema.storageBackends).values({ shopId, config, secretAccessKey, active: true })
    }
  })
  return getSettings(shopId)
}

// Back to the server's disk for new uploads; files in the bucket stay there and keep working
export async function useLocal(shopId: string) {
  await db
    .update(schema.storageBackends)
    .set({ active: false, updatedAt: new Date() })
    .where(and(eq(schema.storageBackends.shopId, shopId), eq(schema.storageBackends.active, true)))
  return getSettings(shopId)
}

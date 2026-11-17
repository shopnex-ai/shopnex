// Where uploads go: the server's disk, or an S3-compatible bucket the shop configures. The bucket is a small fake S3 server
// on localhost that keeps objects in memory, so the connection test really uploads, loads and deletes a file.
import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, before, beforeEach, describe, test } from 'node:test'

// Set before the modules load: @shopnex/db picks its database when it is first imported
process.env.DATABASE_URL = 'pglite:memory'
process.env.APP_URL = 'http://shop.test'
process.env.SHOPNEX_SECRET = 'test-secret-test-secret-test-secret-0123'

const { db, prepareDatabase } = await import('@shopnex/db')
const { files: filesTable, storageBackends } = await import('../src/files.schema')
const { decryptSecret } = await import('@shopnex/db/secrets')
const { fileService, storageService, FilesError } = await import('../src')
const { eq } = await import('drizzle-orm')

// The services take the connection from the caller: the tests pass the shared database
const files = {
  upload: (shop: string, f: File, opts: { alt?: string | null } = {}) => fileService.upload(shop, f, opts, db),
  remove: (shop: string, id: string) => fileService.remove(shop, id, db),
  list: (shop: string, opts: { limit: number; offset: number }) => fileService.list(shop, opts, db),
  count: (shop: string) => fileService.count(shop, db),
}

const storage = {
  getSettings: (shop: string) => storageService.getSettings(shop, db),
  testS3: (shop: string, input: Parameters<typeof storageService.testS3>[1]) => storageService.testS3(shop, input, db),
  useS3: (shop: string, input: Parameters<typeof storageService.useS3>[1]) => storageService.useS3(shop, input, db),
  useLocal: (shop: string) => storageService.useLocal(shop, db),
}

const SHOP = 'default'
const objects = new Map<string, Buffer>()
const fail = { put: false, get: false }
let server: Server
let root: string
let port: number

const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])
const bucket = (name = 'media', secretAccessKey: string | null = 'first-secret') => ({
  preset: 'minio' as const,
  endpoint: `http://127.0.0.1:${port}`,
  region: 'auto',
  bucket: name,
  accessKeyId: 'AKIATEST',
  publicUrl: `http://127.0.0.1:${port}/${name}`,
  forcePathStyle: true,
  ...(secretAccessKey ? { secretAccessKey } : {}),
})
const rows = () => db.select().from(storageBackends).where(eq(storageBackends.shopId, SHOP))

before(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'shopnex-files-'))
  process.env.FILES_DIR = root
  server = createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => {
      const key = req.url ?? ''
      if (req.method === 'PUT' && !fail.put) {
        objects.set(key, Buffer.concat(chunks))
        res.writeHead(200).end()
      } else if (req.method === 'PUT') {
        res.writeHead(403).end('<Error><Code>AccessDenied</Code><Message>Nope</Message></Error>')
      } else if (req.method === 'DELETE') {
        objects.delete(key)
        res.writeHead(204).end()
      } else if (req.method === 'GET' && !fail.get && objects.has(key)) {
        res.writeHead(200).end(objects.get(key))
      } else {
        res.writeHead(403).end()
      }
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  port = (server.address() as AddressInfo).port
  await prepareDatabase()
})

beforeEach(async () => {
  fail.put = fail.get = false
  objects.clear()
  await db.delete(filesTable).where(eq(filesTable.shopId, SHOP))
  await db.delete(storageBackends).where(eq(storageBackends.shopId, SHOP))
})

after(async () => {
  await db.delete(filesTable).where(eq(filesTable.shopId, SHOP))
  await db.delete(storageBackends).where(eq(storageBackends.shopId, SHOP))
  await new Promise((resolve) => server.close(resolve))
  await rm(root, { recursive: true, force: true })
})

describe('settings', () => {
  test('a shop that never configured a bucket uses the disk', async () => {
    assert.deepEqual(await storage.getSettings(SHOP), { provider: 'local', s3: null })
  })
})

describe('the connection test', () => {
  test('uploads, loads from the public URL and deletes, reporting each step, and leaves nothing in the bucket', async () => {
    const { secretAccessKey, ...input } = bucket()
    const result = await storage.testS3(SHOP, { ...input, secretAccessKey })
    assert.deepEqual(result, {
      ok: true,
      steps: [
        { step: 'upload', ok: true },
        { step: 'public', ok: true },
        { step: 'delete', ok: true },
      ],
    })
    assert.equal(objects.size, 0)
  })

  test('says which step failed: a bucket that is not public fails on the public step', async () => {
    fail.get = true
    const result = await storage.testS3(SHOP, bucket())
    assert.equal(result.ok, false)
    assert.deepEqual(
      result.steps.map((s) => [s.step, s.ok]),
      [
        ['upload', true],
        ['public', false],
        ['delete', true],
      ],
    )
    assert.match(result.steps[1]!.error!, /Is public access on for this bucket\?/)
  })

  test('when the upload is refused it stops there, and gives the S3 error', async () => {
    fail.put = true
    const result = await storage.testS3(SHOP, bucket())
    assert.deepEqual(
      result.steps.map((s) => s.step),
      ['upload'],
    )
    assert.match(result.steps[0]!.error!, /HTTP 403: AccessDenied: Nope/)
  })

  test('the first setup needs the secret access key', async () => {
    await assert.rejects(
      storage.testS3(SHOP, bucket('media', null)),
      (e: unknown) => e instanceof FilesError && e.code === 'SECRET_REQUIRED',
    )
  })
})

describe('switching to a bucket', () => {
  test('activates it, keeps the secret encrypted and never returns it', async () => {
    const settings = await storage.useS3(SHOP, bucket())
    assert.equal(settings.provider, 's3')
    assert.equal(settings.s3?.bucket, 'media')
    assert.equal(settings.s3?.hasSecret, true)
    assert.ok(!JSON.stringify(settings).includes('first-secret'))
    const [row] = await rows()
    assert.equal(row!.active, true)
    assert.notEqual(row!.secretAccessKey, 'first-secret')
    assert.equal(decryptSecret(row!.secretAccessKey), 'first-secret')
    assert.ok(!('secretAccessKey' in row!.config))
  })

  test('new uploads go to the bucket, with the public URL of the bucket', async () => {
    await storage.useS3(SHOP, bucket())
    const [row] = await rows()
    const up = await files.upload(SHOP, new File([png], 'x.png'))
    assert.equal(up.storage, row!.id)
    assert.equal(up.url, `http://127.0.0.1:${port}/media/${up.key}`)
    assert.ok(objects.has(`/media/${up.key}`))
  })

  test('a failed connection test changes nothing', async () => {
    fail.put = true
    await assert.rejects(
      storage.useS3(SHOP, bucket()),
      (e: unknown) =>
        e instanceof FilesError && e.code === 'STORAGE_FAILED' && /Connection test failed \(upload\)/.test(e.message),
    )
    assert.deepEqual(await rows(), [])
    assert.equal((await storage.getSettings(SHOP)).provider, 'local')
  })

  test('the same bucket again (rotated keys) updates the same row; the secret can be left out to keep it', async () => {
    await storage.useS3(SHOP, bucket('media', 'first-secret'))
    await storage.useS3(SHOP, bucket('media', 'second-secret'))
    let all = await rows()
    assert.equal(all.length, 1)
    assert.equal(decryptSecret(all[0]!.secretAccessKey), 'second-secret')
    await storage.useS3(SHOP, bucket('media', null))
    all = await rows()
    assert.equal(all.length, 1)
    assert.equal(decryptSecret(all[0]!.secretAccessKey), 'second-secret')
  })

  test('another bucket is a new row and the old one stays, so files keep pointing at where they are', async () => {
    await storage.useS3(SHOP, bucket('first'))
    const [first] = await rows()
    const old = await files.upload(SHOP, new File([png], 'old.png'))
    await storage.useS3(SHOP, bucket('second'))
    const all = await rows()
    assert.equal(all.length, 2)
    assert.deepEqual(
      all.filter((r) => r.active).map((r) => r.config.bucket),
      ['second'],
    )
    const listed = await files.list(SHOP, { limit: 10, offset: 0 })
    assert.equal(listed.find((f) => f.id === old.id)?.url, `http://127.0.0.1:${port}/first/${old.key}`)
    assert.equal(old.storage, first!.id)
  })
})

describe('back to the disk', () => {
  test('new uploads go to the disk again, and files already in the bucket keep working and can be removed', async () => {
    await storage.useS3(SHOP, bucket())
    const inBucket = await files.upload(SHOP, new File([png], 'bucket.png'))
    const settings = await storage.useLocal(SHOP)
    assert.equal(settings.provider, 'local')
    assert.equal(settings.s3?.bucket, 'media')
    const onDisk = await files.upload(SHOP, new File([png], 'disk.png'))
    assert.equal(onDisk.storage, 'local')
    assert.equal(objects.has(`/media/${inBucket.key}`), true)
    await files.remove(SHOP, inBucket.id)
    assert.equal(objects.has(`/media/${inBucket.key}`), false)
  })
})

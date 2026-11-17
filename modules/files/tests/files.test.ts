// Uploading, listing and removing a shop's files on a real in-memory database (PGlite) and a real folder, the way the app
// runs them: the type comes from the bytes, nothing is kept when an upload is refused, and a shop only reaches its own files.
import assert from 'node:assert/strict'
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, before, describe, test } from 'node:test'

// Set before the modules load: @shopnex/db picks its database when it is first imported
process.env.DATABASE_URL = 'pglite:memory'
process.env.APP_URL = 'http://shop.test'
process.env.SHOPNEX_SECRET = 'test-secret-test-secret-test-secret-0123'

const { db, prepareDatabase } = await import('@shopnex/db')
const { files: filesTable, storageBackends } = await import('../src/files.schema')
const { fileService, FilesError, MAX_FILE_SIZE } = await import('../src')
const { eq } = await import('drizzle-orm')

// The services take the connection from the caller: the tests pass the shared database
const files = {
  upload: (shop: string, f: File, opts: { alt?: string | null } = {}) => fileService.upload(shop, f, opts, db),
  remove: (shop: string, id: string) => fileService.remove(shop, id, db),
  list: (shop: string, opts: { limit: number; offset: number }) => fileService.list(shop, opts, db),
  count: (shop: string) => fileService.count(shop, db),
}

const SHOP = 'default'
let root: string

const png = (extra = 8) =>
  new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...new Array<number>(extra).fill(7)])
const file = (bytes: Uint8Array<ArrayBuffer>, name = 'photo.png', type = 'image/png') =>
  new File([bytes], name, { type })
const filesOnDisk = async () => (await readdir(path.join(root, SHOP)).catch(() => [])).length

before(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'shopnex-files-'))
  process.env.FILES_DIR = root
  await prepareDatabase()
})

after(async () => {
  await db.delete(filesTable).where(eq(filesTable.shopId, SHOP))
  await rm(root, { recursive: true, force: true })
})

describe('upload', () => {
  test('stores the bytes and a row, with the type sniffed and the URL the API serves it at', async () => {
    const up = await files.upload(SHOP, file(png()), { alt: 'A cat' })
    assert.match(up.key, new RegExp(`^${SHOP}/[0-9a-f-]{36}\\.png$`))
    assert.equal(up.storage, 'local')
    assert.equal(up.mimeType, 'image/png')
    assert.equal(up.size, 16)
    assert.equal(up.alt, 'A cat')
    assert.equal(up.filename, 'photo.png')
    assert.equal(up.url, `http://shop.test/api/files/${up.key}`)
    assert.deepEqual([...(await readFile(path.join(root, up.key)))], [...png()])
  })

  test('the name and the Content-Type the client sends do not decide the type: the bytes do', async () => {
    const up = await files.upload(SHOP, file(png(), 'looks-like.jpg', 'image/jpeg'))
    assert.equal(up.mimeType, 'image/png')
    assert.ok(up.key.endsWith('.png'))
    assert.equal(up.filename, 'looks-like.jpg')
  })

  test('something that is not an accepted image is refused and leaves nothing behind', async () => {
    const rowsBefore = await files.count(SHOP)
    const diskBefore = await filesOnDisk()
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')
    await assert.rejects(
      files.upload(SHOP, file(svg, 'x.png', 'image/png')),
      (e: unknown) => e instanceof FilesError && e.code === 'UNSUPPORTED_TYPE',
    )
    assert.equal(await files.count(SHOP), rowsBefore)
    assert.equal(await filesOnDisk(), diskBefore)
  })

  test('a file above the limit is refused before it is read', async () => {
    const big = new File([new Uint8Array(MAX_FILE_SIZE + 1)], 'big.png', { type: 'image/png' })
    await assert.rejects(
      files.upload(SHOP, big),
      (e: unknown) => e instanceof FilesError && e.code === 'FILE_TOO_LARGE',
    )
  })

  test('the original name is cut to 255 characters, and an empty name becomes "upload"', async () => {
    const long = await files.upload(SHOP, file(png(), `${'a'.repeat(300)}.png`))
    assert.equal(long.filename.length, 255)
    const empty = await files.upload(SHOP, file(png(), ''))
    assert.equal(empty.filename, 'upload')
    assert.equal(empty.alt, null)
  })
})

describe('list, count and remove', () => {
  test('lists the newest first with their URLs, and pages', async () => {
    await db.delete(filesTable).where(eq(filesTable.shopId, SHOP))
    const first = await files.upload(SHOP, file(png(), 'first.png'))
    await new Promise((resolve) => setTimeout(resolve, 15))
    const second = await files.upload(SHOP, file(png(), 'second.png'))
    assert.equal(await files.count(SHOP), 2)
    const page = await files.list(SHOP, { limit: 10, offset: 0 })
    assert.deepEqual(
      page.map((f) => f.filename),
      ['second.png', 'first.png'],
    )
    assert.equal(page[0]!.url, second.url)
    assert.equal(page[1]!.url, first.url)
    const next = await files.list(SHOP, { limit: 1, offset: 1 })
    assert.deepEqual(
      next.map((f) => f.filename),
      ['first.png'],
    )
  })

  test('another shop sees none of them, and cannot remove them', async () => {
    const up = await files.upload(SHOP, file(png(), 'mine.png'))
    assert.equal(await files.count('some-other-shop'), 0)
    assert.deepEqual(await files.list('some-other-shop', { limit: 10, offset: 0 }), [])
    assert.equal(await files.remove('some-other-shop', up.id), null)
    assert.ok(await readFile(path.join(root, up.key)))
  })

  test('removing deletes the row and the bytes, and answers with what was removed', async () => {
    const up = await files.upload(SHOP, file(png(), 'gone.png'))
    const removed = await files.remove(SHOP, up.id)
    assert.equal(removed?.id, up.id)
    assert.equal(removed?.url, up.url)
    await assert.rejects(readFile(path.join(root, up.key)))
    assert.equal(await files.remove(SHOP, up.id), null)
  })
})

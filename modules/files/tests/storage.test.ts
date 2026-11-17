// The server's disk as a storage backend, and how an S3 bucket's URLs are built. No database.
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, before, describe, test } from 'node:test'

let root: string
before(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'shopnex-files-'))
  process.env.FILES_DIR = root
  process.env.APP_URL = 'http://shop.test/'
})
after(async () => {
  await rm(root, { recursive: true, force: true })
})

const { KEY_PATTERN, localDisk, readLocalFile } = await import('../src/storage')
const { objectUrl, publicFileUrl } = await import('../src/s3')
const config = {
  preset: 'minio',
  endpoint: 'https://s3.example.com',
  region: 'auto',
  bucket: 'media',
  accessKeyId: 'key',
  publicUrl: 'https://cdn.example.com/',
  forcePathStyle: false,
} as const

describe('keys', () => {
  test('a generated key is {shop}/{id}.{ext}; anything that could leave the folder is not a key', () => {
    assert.ok(KEY_PATTERN.test('default/0b9e8d3c-1111-4222-8333-444455556666.png'))
    for (const bad of [
      '../etc/passwd',
      'a/../b.png',
      'shop/a/b.png',
      '/abs/x.png',
      'shop/x.PNG',
      'shop/x',
      'shop/.png',
    ]) {
      assert.ok(!KEY_PATTERN.test(bad), bad)
    }
  })
})

describe('local disk', () => {
  test('stores the bytes under FILES_DIR and serves them back', async () => {
    const key = 'shop-a/3d6f0a64-7a2e-4c58-9d11-000000000001.png'
    await localDisk.put(key, new Uint8Array([1, 2, 3]), 'image/png')
    assert.deepEqual([...(await readFile(path.join(root, key)))], [1, 2, 3])
    const read = await readLocalFile(key)
    assert.equal(read?.size, 3)
  })

  test('never overwrites: a second put of the same key fails and the first bytes stay', async () => {
    const key = 'shop-a/3d6f0a64-7a2e-4c58-9d11-000000000002.png'
    await localDisk.put(key, new Uint8Array([9]), 'image/png')
    await assert.rejects(localDisk.put(key, new Uint8Array([8]), 'image/png'))
    assert.deepEqual([...(await readFile(path.join(root, key)))], [9])
  })

  test('delete removes the file, and is a no-op when it is already gone', async () => {
    const key = 'shop-a/3d6f0a64-7a2e-4c58-9d11-000000000003.png'
    await localDisk.put(key, new Uint8Array([1]), 'image/png')
    await localDisk.delete(key)
    await assert.rejects(stat(path.join(root, key)))
    await localDisk.delete(key)
  })

  test('a key outside the pattern never reaches the disk', async () => {
    await assert.rejects(localDisk.put('../escape.png', new Uint8Array([1]), 'image/png'), /Invalid file key/)
    await assert.rejects(localDisk.delete('../escape.png'), /Invalid file key/)
    assert.equal(await readLocalFile('../escape.png'), null)
  })

  test('reading a file that is not there is null', async () => {
    assert.equal(await readLocalFile('shop-a/3d6f0a64-7a2e-4c58-9d11-0000000000ff.png'), null)
  })

  test('the URL is served by the API, on the public origin without a trailing slash', () => {
    assert.equal(localDisk.name, 'local')
    assert.equal(localDisk.url('shop-a/x.png'), 'http://shop.test/api/files/shop-a/x.png')
  })
})

describe('S3 URLs', () => {
  test('virtual-hosted style puts the bucket in the host', () => {
    assert.equal(objectUrl(config, 'shop/x.png'), 'https://media.s3.example.com/shop/x.png')
  })

  test('path style puts the bucket in the path, whatever trailing slash the endpoint has', () => {
    assert.equal(
      objectUrl({ ...config, forcePathStyle: true, endpoint: 'http://localhost:9000/' }, 'shop/x.png'),
      'http://localhost:9000/media/shop/x.png',
    )
  })

  test('the public URL is the configured base with the key appended, without doubling the slash', () => {
    assert.equal(publicFileUrl(config, 'shop/x.png'), 'https://cdn.example.com/shop/x.png')
    assert.equal(
      publicFileUrl({ ...config, publicUrl: 'https://cdn.example.com///' }, 'k.png'),
      'https://cdn.example.com/k.png',
    )
  })
})

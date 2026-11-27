// callApp in multi-tenant mode: an app's address comes from someone who is not the operator (a marketplace listing, a developer), so
// ShopNex's server must not be made to call the platform's own network. An address the operator named in its own configuration
// (<NAME>_APP_URL with <NAME>_APP_INTERNAL_URL: the bundled apps under Docker) is the operator's choice and is let through.
// The mode is read when the code loads, so this file (its own process under `node --test`) sets it first.
import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { after, before, describe, test } from 'node:test'

process.env.DATABASE_URL = 'pglite:memory'
process.env.SHOPNEX_SECRET = 'test-secret-test-secret-test-secret-0123'
process.env.TENANCY_MODE = 'multi'
process.env.ROOT_DOMAIN = 'shopnex.test'
process.env.APP_URL = 'https://admin.shopnex.test'

let server: Server
let hits = 0
let port = 0

before(async () => {
  server = createServer((_req, res) => {
    hits++
    res.writeHead(200).end('reached')
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  port = (server.address() as AddressInfo).port
  // The operator's own configuration: this public name is served from the local port (as a bundled app is under Docker)
  process.env.MAPPED_APP_URL = 'http://mapped-app.example.test'
  process.env.MAPPED_APP_INTERNAL_URL = `http://127.0.0.1:${port}`
})

after(async () => {
  server.closeAllConnections()
  await new Promise((resolve) => server.close(resolve))
  setImmediate(() => process.exit())
})

const { callApp } = await import('../src/call-app')
const call = (url: string) => callApp(url, { headers: {}, body: '{}', timeoutMs: 2000 })

describe('callApp in multi-tenant mode', () => {
  test('refuses an address on the local machine, and nothing is sent', async () => {
    await assert.rejects(call(`http://127.0.0.1:${port}/x`), /private network address/)
    assert.equal(hits, 0)
  })

  test('refuses a name that resolves to the local machine', async () => {
    await assert.rejects(call(`http://localhost:${port}/x`), /private network address/)
    assert.equal(hits, 0)
  })

  test('refuses the other private ranges, cloud metadata included', async () => {
    for (const host of ['10.0.0.5', '192.168.1.10', '172.16.0.1', '169.254.169.254', '[::1]']) {
      await assert.rejects(call(`http://${host}/x`), /private network address/, host)
    }
    assert.equal(hits, 0)
  })

  test('lets through an address the operator named in its own configuration', async () => {
    const r = await call('http://mapped-app.example.test/x')
    assert.equal(r.text, 'reached')
    assert.equal(hits, 1)
  })
})

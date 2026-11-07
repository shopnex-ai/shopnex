import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { after, before, test } from 'node:test'
import { createAdminClient, ShopnexError } from '../src/admin'

const seen: { method?: string; url?: string; auth?: string; body?: string }[] = []
const server = createServer(async (req, res) => {
  let body = ''
  for await (const chunk of req) body += chunk
  seen.push({ method: req.method, url: req.url, auth: req.headers.authorization, body })
  if (req.url?.includes('missing')) {
    res.writeHead(404, { 'content-type': 'application/json' })
    return void res.end(JSON.stringify({ code: 'NOT_FOUND', message: 'No such key' }))
  }
  if (req.method === 'DELETE') return void res.writeHead(204).end()
  res.writeHead(200, { 'content-type': 'application/json' })
  res.end(JSON.stringify({ value: { a: 1 } }))
})
let admin: ReturnType<typeof createAdminClient>
before(async () => {
  await new Promise<void>((resolve) => server.listen(0, resolve))
  admin = createAdminClient(
    'http://shop.test',
    async () => 'tok',
    `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
  )
})
after(() => server.close())

test('typed calls fill path params, send the token and the JSON body, and return the data', async () => {
  const got = await admin.api.get('/app-data/{key}', { params: { path: { key: 'a b' } } })
  assert.deepEqual(got, { value: { a: 1 } })
  await admin.api.put('/app-data/{key}', { params: { path: { key: 'k' } }, body: { value: { x: 1 } } })
  const [get, put] = seen.slice(-2)
  assert.equal(get.url, '/api/v1/admin/app-data/a%20b')
  assert.equal(get.auth, 'Bearer tok')
  assert.equal(put.method, 'PUT')
  assert.deepEqual(JSON.parse(put.body!), { value: { x: 1 } })
})

test('an error answer throws a ShopnexError with its status', async () => {
  await assert.rejects(
    () => admin.api.get('/app-data/{key}', { params: { path: { key: 'missing' } } }),
    (error) => error instanceof ShopnexError && error.status === 404 && /No such key/.test(error.message),
  )
})

test('an empty answer (204) resolves', async () => {
  await admin.api.delete('/app-data/{key}', { params: { path: { key: 'k' } } })
})

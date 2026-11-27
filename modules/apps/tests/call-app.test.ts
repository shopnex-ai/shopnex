// The one way ShopNex's server calls an app (payments, shipping rates, AI, the installed call): what it sends, what it refuses to
// follow, and how much of the answer it will read. Single mode: the operator is the merchant, so any address is allowed.
// The multi-tenant address rules are in call-app-multi.test.ts (the mode is read when the code loads).
import assert from 'node:assert/strict'
import { createServer, type IncomingMessage, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { after, describe, test } from 'node:test'
import './fixtures'

const { callApp } = await import('../src/call-app')

const servers: Server[] = []
async function listen(
  handler: (
    req: IncomingMessage,
    body: string,
  ) => { status?: number; headers?: Record<string, string>; body?: string } | Promise<never>,
) {
  const seen: { url: string; headers: IncomingMessage['headers']; body: string }[] = []
  const server = createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString()
      seen.push({ url: req.url ?? '', headers: req.headers, body })
      Promise.resolve(handler(req, body)).then(
        (r) => res.writeHead(r.status ?? 200, r.headers).end(r.body ?? ''),
        () => undefined, // never answers: the caller's timeout is what ends it
      )
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  servers.push(server)
  return { seen, url: `http://127.0.0.1:${(server.address() as AddressInfo).port}` }
}

after(async () => {
  for (const s of servers) {
    s.closeAllConnections()
    await new Promise((resolve) => s.close(resolve))
  }
  setImmediate(() => process.exit())
})

describe('callApp', () => {
  test('posts the body with the headers it is given, and gives back the status and the text', async () => {
    const app = await listen(() => ({ status: 200, body: '{"ok":true}' }))
    const r = await callApp(`${app.url}/pay`, { headers: { 'x-sig': 'abc' }, body: '{"a":1}', timeoutMs: 2000 })
    assert.deepEqual({ ok: r.ok, status: r.status, text: r.text }, { ok: true, status: 200, text: '{"ok":true}' })
    assert.equal(app.seen[0]!.url, '/pay')
    assert.equal(app.seen[0]!.headers['x-sig'], 'abc')
    assert.equal(app.seen[0]!.body, '{"a":1}')
  })

  test('an error answer comes back as an answer (not an exception) with its text', async () => {
    const app = await listen(() => ({ status: 503, body: 'down for now' }))
    const r = await callApp(app.url, { headers: {}, body: '{}', timeoutMs: 2000 })
    assert.deepEqual({ ok: r.ok, status: r.status, text: r.text }, { ok: false, status: 503, text: 'down for now' })
  })

  test('a redirect is not followed: the answer is the redirect, and the place it points to is never called', async () => {
    const target = await listen(() => ({ body: 'secret' }))
    const app = await listen(() => ({ status: 302, headers: { location: `${target.url}/inside` } }))
    const r = await callApp(app.url, { headers: {}, body: '{}', timeoutMs: 2000 })
    assert.equal(r.status, 302)
    assert.equal(r.ok, false)
    assert.equal(target.seen.length, 0)
  })

  test('an answer over the limit is refused, one within it is read in full', async () => {
    const app = await listen(() => ({ body: 'x'.repeat(1000) }))
    const within = await callApp(app.url, { headers: {}, body: '{}', timeoutMs: 2000, maxBytes: 1000 })
    assert.equal(within.text.length, 1000)
    await assert.rejects(
      callApp(app.url, { headers: {}, body: '{}', timeoutMs: 2000, maxBytes: 999 }),
      /The answer is too large/,
    )
  })

  test('the default limit is 1 MB', async () => {
    const app = await listen(() => ({ body: 'x'.repeat(1_000_001) }))
    await assert.rejects(callApp(app.url, { headers: {}, body: '{}', timeoutMs: 2000 }), /The answer is too large/)
  })

  test('an app that never answers is cut off at the timeout', async () => {
    const app = await listen(() => new Promise<never>(() => undefined))
    const started = Date.now()
    await assert.rejects(callApp(app.url, { headers: {}, body: '{}', timeoutMs: 150 }))
    assert.ok(Date.now() - started < 2000, 'it did not wait for the app')
  })

  test('single mode: an address on the local machine is allowed (the operator chose the app)', async () => {
    const app = await listen(() => ({ body: 'hi' }))
    assert.equal((await callApp(app.url, { headers: {}, body: '{}', timeoutMs: 2000 })).text, 'hi')
  })
})

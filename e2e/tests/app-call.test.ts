// How ShopNex's server calls an app (callApp): signed, to the address the server can reach, never following a redirect,
// with a timeout and a cap on the answer, and a readable error when something goes wrong. Payment sessions, carrier
// rates and AI runs all go through it. A fake app is served by this test and checks the signature like a real one.
// The last group runs the carrier path in a shop of its own: the default shop of a dev database may have real carrier
// apps installed, which would answer too.
import assert from 'node:assert/strict'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { after, before, describe, test } from 'node:test'
import { eq } from 'drizzle-orm'
import { appService, callApp, instanceUrl } from '@shopnex/apps'
import { carrierService } from '@shopnex/cart'
import { db, schema } from '@shopnex/db'
import { signAiRequest, verifyAiRequest } from '@shopnex/marketplace-sdk/ai'
import { createJwksResolver } from '@shopnex/marketplace-sdk/keys'
import { signPaymentsRequest, verifyPaymentsRequest } from '@shopnex/marketplace-sdk/payments'
import { signRatesRequest, verifyRatesRequest } from '@shopnex/marketplace-sdk/shipping'
import { Fixtures, closeDb, requireApp } from '../lib'

const fx = new Fixtures()
const keys = createJwksResolver({ allowHttp: true })

let server: Server
let base: string
const hits: string[] = []
const handlers: Record<string, (req: IncomingMessage, res: ServerResponse, body: string) => void | Promise<void>> = {}

before(async () => {
  await requireApp()
  await fx.init()
  server = createServer(async (req, res) => {
    let body = ''
    for await (const chunk of req) body += chunk
    hits.push(req.url ?? '')
    const handler = handlers[req.url ?? '']
    if (!handler) return res.writeHead(404).end('no such path')
    await handler(req, res, body)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

after(async () => {
  server?.closeAllConnections()
  server?.close()
  await fx.cleanup()
  await closeDb()
})

const json = (res: ServerResponse, status: number, value: unknown) => {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify(value))
}
const bodyOf = async (kind: string, extra: object = {}) =>
  JSON.stringify({ kind, id: 'call-1', instance: await instanceUrl(), ...extra })

describe('what the app receives', () => {
  const kinds = [
    {
      name: 'payments',
      kind: 'payment',
      userAgent: 'Shopnex-Payments/1.0',
      sign: signPaymentsRequest,
      verify: verifyPaymentsRequest,
    },
    {
      name: 'shipping',
      kind: 'rates',
      userAgent: 'Shopnex-Shipping/1.0',
      sign: signRatesRequest,
      verify: verifyRatesRequest,
    },
    { name: 'ai', kind: 'ai.run', userAgent: 'Shopnex-AI/1.0', sign: signAiRequest, verify: verifyAiRequest },
  ] as const

  for (const k of kinds) {
    test(`${k.name}: a request signed with the instance's key, that the app can verify`, async () => {
      let seen: { verified: unknown; userAgent: string | undefined; webhookId: string | undefined } | null = null
      handlers['/signed'] = async (req, res, body) => {
        const headers = new Headers(req.headers as Record<string, string>)
        seen = {
          verified: await k.verify(headers, body, { keys }),
          userAgent: req.headers['user-agent'],
          webhookId: req.headers['webhook-id'] as string | undefined,
        }
        json(res, 200, { received: true })
      }
      const answer = await callApp(`${base}/signed`, {
        id: 'call-1',
        body: await bodyOf(k.kind),
        sign: k.sign,
        timeoutMs: 5000,
      })
      assert.deepEqual(answer, { received: true })
      assert.ok(seen!.verified, 'the app could verify it against the instance’s published keys')
      assert.equal(seen!.userAgent, k.userAgent)
      assert.equal(seen!.webhookId, 'call-1')
    })
  }
})

describe('what comes back', () => {
  const call = (path: string, extra: object = {}) =>
    bodyOf('payment').then((body) =>
      callApp(`${base}${path}`, { id: 'call-1', body, sign: signPaymentsRequest, timeoutMs: 5000, ...extra }),
    )

  test('an empty or non-JSON answer is null, unless the app must answer JSON', async () => {
    handlers['/empty'] = (_req, res) => void res.writeHead(202).end()
    handlers['/text'] = (_req, res) => void res.writeHead(200).end('thanks')
    assert.equal(await call('/empty'), null)
    assert.equal(await call('/text'), null)
    await assert.rejects(call('/empty', { requireJson: true }), /something other than JSON/)
    await assert.rejects(call('/text', { requireJson: true }), /something other than JSON/)
  })

  test('an error answer becomes a message with the status and the start of what the app said', async () => {
    handlers['/down'] = (_req, res) => void res.writeHead(502).end('provider down')
    handlers['/long-error'] = (_req, res) => void res.writeHead(500).end('x'.repeat(200_000))
    await assert.rejects(call('/down'), /^Error: 502 provider down$/)
    await assert.rejects(call('/long-error'), (e: Error) => /^500 x+$/.test(e.message) && e.message.length <= 304)
  })

  test('an app can explain its own failure: that is what staff read', async () => {
    handlers['/explains'] = (_req, res) => json(res, 422, { error: 'The product has no image' })
    const errorFrom = (text: string) => {
      try {
        const { error } = JSON.parse(text) as { error?: unknown }
        return typeof error === 'string' ? error : null
      } catch {
        return null
      }
    }
    await assert.rejects(call('/explains', { errorFrom }), /^Error: The product has no image$/)
    await assert.rejects(call('/explains'), /^Error: 422 \{"error":"The product has no image"\}$/)
  })

  test('a redirect is not followed: the server is never sent somewhere else', async () => {
    hits.length = 0
    handlers['/moved'] = (_req, res) => void res.writeHead(302, { location: `${base}/target` }).end()
    handlers['/target'] = (_req, res) => json(res, 200, { reached: true })
    await assert.rejects(call('/moved'), /^Error: 302/)
    assert.ok(!hits.includes('/target'), 'the redirect target was never requested')
  })

  test('an answer bigger than allowed is refused, however it is sent', async () => {
    const big = JSON.stringify({ filler: 'y'.repeat(5000) })
    handlers['/sized'] = (_req, res) => void res.writeHead(200, { 'content-length': String(big.length) }).end(big)
    handlers['/chunked'] = async (_req, res) => {
      res.writeHead(200)
      for (let i = 0; i < 20; i++) res.write('z'.repeat(500))
      res.end()
    }
    await assert.rejects(call('/sized', { maxBytes: 1000 }), /too large/)
    await assert.rejects(call('/chunked', { maxBytes: 1000 }), /too large/)
    assert.deepEqual(await call('/sized', { maxBytes: 10_000 }), JSON.parse(big), 'within the limit it is fine')
  })

  test('the limit is on the size, so an answer of exactly that many bytes is let through', async () => {
    const exact = JSON.stringify({ k: 'v'.repeat(100) })
    handlers['/exact'] = (_req, res) => void res.writeHead(200).end(exact)
    assert.deepEqual(await call('/exact', { maxBytes: exact.length }), JSON.parse(exact))
    await assert.rejects(call('/exact', { maxBytes: exact.length - 1 }), /too large/)
  })

  test('an app that does not answer in time is given up on', async () => {
    handlers['/hang'] = () => new Promise(() => {})
    const started = Date.now()
    await assert.rejects(call('/hang', { timeoutMs: 300 }))
    assert.ok(Date.now() - started < 3000, 'gave up at the timeout')
  })

  test('an app that is not there is an error, not a hang', async () => {
    await assert.rejects(call('/nothing-here'), /^Error: 404 no such path$/)
  })
})

describe('where the call goes', () => {
  test('a public app address is swapped for the one the server can reach (bundled apps under Docker)', async () => {
    handlers['/via-internal'] = (_req, res) => json(res, 200, { reached: 'internal' })
    process.env.E2ECALL_APP_URL = 'http://public.invalid:4999'
    process.env.E2ECALL_APP_INTERNAL_URL = base
    try {
      const answer = await callApp('http://public.invalid:4999/via-internal', {
        id: 'call-1',
        body: await bodyOf('payment'),
        sign: signPaymentsRequest,
        timeoutMs: 5000,
      })
      assert.deepEqual(answer, { reached: 'internal' })
    } finally {
      delete process.env.E2ECALL_APP_URL
      delete process.env.E2ECALL_APP_INTERNAL_URL
    }
  })
})

describe('carrier quotes, in a shop of its own', () => {
  let shopId: string
  let appId: string
  const input = {
    currency: 'USD',
    destination: { countryCode: 'AQ', province: null, city: null, zip: null, address1: null, address2: null },
    items: [],
    subtotalCents: 2000,
  }

  before(async () => {
    shopId = (await fx.shop()).id
    const { app } = await appService.registerApp(
      { name: `E2E call ${Date.now()}`, appUrl: `${base}/app`, redirectUrls: [], scopes: ['write_shipping'] },
      null,
    )
    appId = app.id
    await carrierService.configure(shopId, appId, { name: 'E2E Carrier', ratesUrl: `${base}/rates`, ready: true })
  })

  after(async () => {
    if (appId) await db.delete(schema.apps).where(eq(schema.apps.id, appId))
  })

  const quote = async () => {
    const realError = console.error
    console.error = () => {}
    try {
      return await carrierService.quote(shopId, input)
    } finally {
      console.error = realError
    }
  }

  test("the app's rates come back as the shop's own, cheapest first, from a verifiable signed request", async () => {
    let verified: unknown = null
    handlers['/rates'] = async (req, res, body) => {
      verified = await verifyRatesRequest(new Headers(req.headers as Record<string, string>), body, { keys })
      json(res, 200, {
        rates: [
          { code: 'express', name: 'Express', priceCents: 2500 },
          { code: 'post', name: 'Post', priceCents: 500, description: 'Slow' },
        ],
      })
    }
    const rates = await quote()
    assert.deepEqual(
      rates.map((r) => [r.title, r.priceCents, r.carrier]),
      [
        ['Post', 500, 'E2E Carrier'],
        ['Express', 2500, 'E2E Carrier'],
      ],
    )
    assert.ok(verified, 'the app could verify the request')
    assert.equal((verified as { kind: string }).kind, 'rates')
  })

  test('a failing, non-JSON, redirecting or oversized answer means no rates, never a broken checkout', async () => {
    hits.length = 0
    handlers['/target'] = (_req, res) => json(res, 200, { rates: [{ code: 'x', name: 'Sneaky', priceCents: 1 }] })
    const cases: Record<string, (req: IncomingMessage, res: ServerResponse) => void> = {
      error: (_req, res) => void res.writeHead(500).end('down'),
      notJson: (_req, res) => void res.writeHead(200).end('<html>maintenance</html>'),
      noRates: (_req, res) => json(res, 200, { thanks: true }),
      redirect: (_req, res) => void res.writeHead(302, { location: `${base}/target` }).end(),
      // More than the 256 KB a rates answer may take
      oversized: (_req, res) =>
        json(res, 200, { rates: [{ code: 'a', name: 'A', priceCents: 100, description: 'd'.repeat(300_000) }] }),
    }
    for (const [name, answer] of Object.entries(cases)) {
      handlers['/rates'] = (req, res) => answer(req, res)
      assert.deepEqual(await quote(), [], name)
    }
    assert.ok(!hits.includes('/target'), 'the redirect was not followed')
  })
})

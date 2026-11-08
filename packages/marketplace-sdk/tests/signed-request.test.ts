// Payments, shipping and AI requests are signed and verified by one shared implementation (signed-request.ts), each
// kind adding only its user agent and its `kind`. Shipping used to carry its own copy of both halves, which would
// have stopped following any fix made to the shared one. These cases run the same behaviors against all three, so a
// kind that drifts away from the others fails here.
import assert from 'node:assert/strict'
import test from 'node:test'
import { generateKeyPair, importPublicKey, signer, type KeyResolver } from '../src/keys'
import { signAiRequest, verifyAiRequest } from '../src/ai'
import { signPaymentsRequest, verifyPaymentsRequest } from '../src/payments'
import { signRatesRequest, verifyRatesRequest } from '../src/shipping'

const INSTANCE = 'https://shop.example.com'

type Kind = {
  name: string
  userAgent: string
  /** A body this kind accepts, and the same body with another kind in it */
  body: (extra?: object) => string
  wrongKindBody: string
  sign: (s: Awaited<ReturnType<typeof signer>>, id: string, body: string, now?: Date) => Promise<Record<string, string>>
  verify: (headers: Headers, body: string, o: { keys: KeyResolver; toleranceSeconds?: number }) => Promise<unknown>
}

const kinds: Kind[] = [
  {
    name: 'payments',
    userAgent: 'Shopnex-Payments/1.0',
    body: (extra) => JSON.stringify({ kind: 'payment', id: 'r1', instance: INSTANCE, ...extra }),
    // Payments requests have no kind of their own to refuse: any body from the instance verifies
    wrongKindBody: JSON.stringify({ kind: 'payment', id: 'r1', instance: INSTANCE }),
    sign: signPaymentsRequest,
    verify: verifyPaymentsRequest,
  },
  {
    name: 'shipping',
    userAgent: 'Shopnex-Shipping/1.0',
    body: (extra) => JSON.stringify({ kind: 'rates', id: 'r1', instance: INSTANCE, ...extra }),
    wrongKindBody: JSON.stringify({ kind: 'payment', id: 'r1', instance: INSTANCE }),
    sign: signRatesRequest,
    verify: verifyRatesRequest,
  },
  {
    name: 'ai',
    userAgent: 'Shopnex-AI/1.0',
    body: (extra) => JSON.stringify({ kind: 'ai.run', id: 'r1', instance: INSTANCE, ...extra }),
    wrongKindBody: JSON.stringify({ kind: 'rates', id: 'r1', instance: INSTANCE }),
    sign: signAiRequest,
    verify: verifyAiRequest,
  },
]

async function instanceKeys() {
  const { privateKey, publicKey } = await generateKeyPair()
  const key = await importPublicKey(publicKey)
  const keys: KeyResolver = async () => key
  return { signer: await signer(privateKey), keys }
}

const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000)
const headersOf = (h: Record<string, string>) => new Headers(h)

for (const kind of kinds) {
  test(`${kind.name}: a correctly signed request verifies, and says who sent it`, async () => {
    const { signer: s, keys } = await instanceKeys()
    const body = kind.body()
    const headers = await kind.sign(s, 'r1', body)
    assert.equal(headers['user-agent'], kind.userAgent)
    assert.equal(headers['webhook-id'], 'r1')
    assert.match(headers['webhook-signature']!, /^v1a,/)
    assert.ok(headers['shopnex-key-id'])
    const request = (await kind.verify(headersOf(headers), body, { keys })) as { instance: string }
    assert.equal(request?.instance, INSTANCE)
  })

  test(`${kind.name}: a changed body, another key, or a missing header is refused`, async () => {
    const { signer: s, keys } = await instanceKeys()
    const body = kind.body()
    const headers = await kind.sign(s, 'r1', body)
    assert.equal(await kind.verify(headersOf(headers), body.replace('r1', 'r2'), { keys }), null, 'changed body')

    const other = await instanceKeys()
    assert.equal(await kind.verify(headersOf(headers), body, { keys: other.keys }), null, 'someone else’s key')

    for (const missing of ['webhook-id', 'webhook-timestamp', 'webhook-signature']) {
      const { [missing]: _dropped, ...rest } = headers
      assert.equal(await kind.verify(headersOf(rest), body, { keys }), null, `no ${missing}`)
    }
  })

  test(`${kind.name}: a request that is too old, or from the future, is refused; the tolerance can be set`, async () => {
    const { signer: s, keys } = await instanceKeys()
    const body = kind.body()
    const stale = await kind.sign(s, 'r1', body, minutesAgo(10))
    assert.equal(await kind.verify(headersOf(stale), body, { keys }), null, '10 minutes old')
    const future = await kind.sign(s, 'r1', body, new Date(Date.now() + 10 * 60_000))
    assert.equal(await kind.verify(headersOf(future), body, { keys }), null, '10 minutes ahead')

    const minuteOld = await kind.sign(s, 'r1', body, minutesAgo(1))
    assert.ok(await kind.verify(headersOf(minuteOld), body, { keys }), 'a minute old is fine by default')
    assert.equal(await kind.verify(headersOf(minuteOld), body, { keys, toleranceSeconds: 30 }), null, 'not with 30s')
  })

  test(`${kind.name}: the body is only trusted once the instance it names has signed it`, async () => {
    const { signer: s, keys } = await instanceKeys()
    const noInstance = JSON.stringify({ kind: JSON.parse(kind.body()).kind, id: 'r1' })
    assert.equal(await kind.verify(headersOf(await kind.sign(s, 'r1', noInstance)), noInstance, { keys }), null)
    const notJson = 'not json'
    assert.equal(await kind.verify(headersOf(await kind.sign(s, 'r1', notJson)), notJson, { keys }), null)
  })

  test(`${kind.name}: a resolver that does not know the instance refuses it`, async () => {
    const { signer: s } = await instanceKeys()
    const body = kind.body()
    const headers = await kind.sign(s, 'r1', body)
    assert.equal(await kind.verify(headersOf(headers), body, { keys: async () => null }), null)
  })
}

test('shipping and ai refuse a request of another kind, even correctly signed', async () => {
  const { signer: s, keys } = await instanceKeys()
  for (const kind of kinds.filter((k) => k.name !== 'payments')) {
    const headers = await kind.sign(s, 'r1', kind.wrongKindBody)
    assert.equal(await kind.verify(headersOf(headers), kind.wrongKindBody, { keys }), null, kind.name)
  }
})

test('one of several signatures is enough, as with Standard Webhooks key rotation', async () => {
  const { signer: s, keys } = await instanceKeys()
  for (const kind of kinds) {
    const body = kind.body()
    const headers = await kind.sign(s, 'r1', body)
    const rotated = { ...headers, 'webhook-signature': `v1a,AAAA ${headers['webhook-signature']} v1,legacy` }
    assert.ok(await kind.verify(headersOf(rotated), body, { keys }), kind.name)
  }
})

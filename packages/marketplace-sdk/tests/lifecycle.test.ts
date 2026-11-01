import test from 'node:test'
import assert from 'node:assert/strict'

import { generateKeyPair, importPublicKey, signer } from '../src/keys'
import { signLifecycleRequest, verifyLifecycleRequest, type AppInstalledRequest } from '../src/lifecycle'

const request: AppInstalledRequest = {
  kind: 'installed',
  id: 'evt-1',
  instance: 'https://shop.example.com',
  shopId: 'shop-1',
  installationId: 'inst-1',
}

async function setup() {
  const pair = await generateKeyPair()
  const key = await importPublicKey(pair.publicKey)
  return { signer: await signer(pair.privateKey), keys: async () => key }
}

test('an app.installed request verifies against the instance key', async () => {
  const { signer: s, keys } = await setup()
  const body = JSON.stringify(request)
  const headers = new Headers(await signLifecycleRequest(s, request.id, body))
  assert.deepEqual(await verifyLifecycleRequest(headers, body, { keys }), request)
})

test('a tampered body, a stale timestamp or another key is rejected', async () => {
  const { signer: s, keys } = await setup()
  const body = JSON.stringify(request)
  const headers = new Headers(await signLifecycleRequest(s, request.id, body))
  const tampered = JSON.stringify({ ...request, shopId: 'shop-2' })
  assert.equal(await verifyLifecycleRequest(headers, tampered, { keys }), null)

  const old = new Headers(await signLifecycleRequest(s, request.id, body, new Date(Date.now() - 10 * 60_000)))
  assert.equal(await verifyLifecycleRequest(old, body, { keys }), null)

  const other = await setup()
  assert.equal(await verifyLifecycleRequest(headers, body, { keys: other.keys }), null)
})

test('only the installed kind is accepted', async () => {
  const { signer: s, keys } = await setup()
  const body = JSON.stringify({ ...request, kind: 'payment' })
  const headers = new Headers(await signLifecycleRequest(s, request.id, body))
  assert.equal(await verifyLifecycleRequest(headers, body, { keys }), null)
})

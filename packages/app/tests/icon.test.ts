import assert from 'node:assert/strict'
import { test } from 'node:test'
import { generateKeyPair } from '@shopnex/marketplace-sdk/keys'
import { createShopnexApp } from '../src/index'

const options = async () => ({ clientId: 'app_test', appKey: (await generateKeyPair()).privateKey })

test('serves the icon as an image, with a CSP that stops scripts if the URL is opened directly', async () => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"/>'
  const res = await createShopnexApp({ ...(await options()), icon: svg }).routes.request('/icon.svg')
  assert.equal(res.status, 200)
  assert.equal(res.headers.get('content-type'), 'image/svg+xml')
  assert.equal(res.headers.get('content-security-policy'), "default-src 'none'; sandbox")
  assert.equal(await res.text(), svg)
})

test('without an icon there is no /icon.svg route', async () => {
  assert.equal((await createShopnexApp(await options()).routes.request('/icon.svg')).status, 404)
})

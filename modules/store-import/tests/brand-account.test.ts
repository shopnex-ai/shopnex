// Whether the store's header has a customer account link decides the new shop's "Show Account link" setting.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readBrand } from '../src/brand'
import type { Fetcher } from '../src/fetcher'

const read = async (body: string) => {
  const fetcher = {
    text: async (url: string) => (url.endsWith('/') ? `<html><body>${body}</body></html>` : ''),
  } as unknown as Fetcher
  return (await readBrand('https://example.com', fetcher)).hasAccount
}

test('a store whose header has no account link is read as having no customer accounts', async () => {
  assert.equal(await read('<header><a href="/cart">Cart</a></header>'), false)
  assert.equal(await read('<header><a href="/account/login">Log in</a></header>'), true)
  assert.equal(await read('<div>no header element</div>'), true)
})

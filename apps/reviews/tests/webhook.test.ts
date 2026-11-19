import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import type { ShopContext } from '@shopnex/app'
import { ensureWebhook } from '../src/webhook'

const APP_URL = 'https://reviews.example.com'
const URL = `${APP_URL}/shopnex/webhook`

type Hook = { id: string; url: string; active: boolean; topics: string[] }
const hook = (id: string, extra: Partial<Hook> = {}): Hook => ({
  id,
  url: URL,
  active: true,
  topics: ['order.fulfilled'],
  ...extra,
})

// A shop whose Admin API keeps the webhooks in a list, slowly, like a real one
function fakeShop(initial: Hook[] = [], instance = 'https://shop.example.com') {
  const hooks = [...initial]
  const calls = { get: 0, post: 0, delete: 0 }
  const slow = () => new Promise((r) => setTimeout(r, 20))
  const shop = {
    instance,
    shopId: 'default',
    admin: {
      api: {
        get: async () => {
          calls.get++
          await slow()
          return hooks.map((h) => ({ ...h }))
        },
        post: async (_path: string, init: { body: Omit<Hook, 'id'> }) => {
          calls.post++
          await slow()
          hooks.push({ id: `new-${hooks.length}`, ...init.body })
        },
        delete: async (_path: string, init: { params: { path: { id: string } } }) => {
          calls.delete++
          await slow()
          hooks.splice(
            hooks.findIndex((h) => h.id === init.params.path.id),
            1,
          )
        },
      },
    },
  } as unknown as ShopContext
  return { shop, hooks, calls }
}

describe('ensureWebhook', () => {
  test('makes the subscription when there is none', async () => {
    const { shop, hooks } = fakeShop()
    await ensureWebhook(shop, APP_URL)
    assert.equal(hooks.length, 1)
    assert.deepEqual(hooks[0]!.topics, ['order.fulfilled'])
  })

  test('app.installed and the first page load at the same time make one subscription, not two', async () => {
    const { shop, hooks, calls } = fakeShop()
    await Promise.all([ensureWebhook(shop, APP_URL), ensureWebhook(shop, APP_URL)])
    assert.equal(hooks.length, 1)
    assert.equal(calls.post, 1)
  })

  test('another shop is not held up by, or merged into, a run that is in flight', async () => {
    const a = fakeShop([], 'https://a.example.com')
    const b = fakeShop([], 'https://b.example.com')
    await Promise.all([ensureWebhook(a.shop, APP_URL), ensureWebhook(b.shop, APP_URL)])
    assert.equal(a.hooks.length, 1)
    assert.equal(b.hooks.length, 1)
  })

  test('leaves an existing subscription alone', async () => {
    const { shop, hooks, calls } = fakeShop([hook('a')])
    await ensureWebhook(shop, APP_URL)
    assert.deepEqual(
      hooks.map((h) => h.id),
      ['a'],
    )
    assert.equal(calls.post + calls.delete, 0)
  })

  test('deletes duplicates that are already there (another process, an older version) and keeps one', async () => {
    const { shop, hooks } = fakeShop([hook('a'), hook('b'), hook('c')])
    await ensureWebhook(shop, APP_URL)
    assert.deepEqual(
      hooks.map((h) => h.id),
      ['a'],
    )
  })

  test("only touches this app's subscription: another URL, an inactive one, or other topics do not count", async () => {
    const { shop, hooks } = fakeShop([
      hook('other-url', { url: 'https://elsewhere.example.com/hook' }),
      hook('inactive', { active: false }),
      hook('wrong-topic', { topics: ['order.paid'] }),
    ])
    await ensureWebhook(shop, APP_URL)
    assert.equal(hooks.length, 4)
    assert.equal(hooks.filter((h) => h.url === URL && h.active && h.topics.includes('order.fulfilled')).length, 1)
  })

  test('a failed run can be tried again', async () => {
    const { shop, hooks } = fakeShop()
    const api = shop.admin.api as unknown as { get: () => Promise<unknown> }
    const original = api.get
    api.get = async () => {
      throw new Error('503')
    }
    await assert.rejects(() => ensureWebhook(shop, APP_URL), /503/)
    api.get = original
    await ensureWebhook(shop, APP_URL)
    assert.equal(hooks.length, 1)
  })
})

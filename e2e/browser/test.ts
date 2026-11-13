// `test` and `expect` for the browser specs. Every request that leaves the machine is blocked: the hosted checkout
// links Google Fonts, and a CI runner that reaches it slowly held the page's load event open for ~40s, so checkout
// tests timed out. The tests only talk to the app, the storefront and the fake providers they start themselves.
import { test as base } from '@playwright/test'

export { expect } from '@playwright/test'
export type { Page } from '@playwright/test'

const LOCAL = new Set(['localhost', '127.0.0.1', '[::1]'])

export const test = base.extend({
  context: async ({ context }, use) => {
    await context.route(
      (url) => /^https?:$/.test(url.protocol) && !LOCAL.has(url.hostname),
      (route) => route.abort(),
    )
    await use(context)
  },
})

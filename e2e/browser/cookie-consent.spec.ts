// What a visitor sees when the shop asks for consent: scripts a merchant marked data-consent stay off until they agree,
// the choice is remembered without a cookie, and it can be changed. With the banner off nobody is asked and the scripts
// run. The storefront's own pages have no such script, so one is added to the page's HTML on its way to the browser.
import { getShopById, updateShop } from '@shopnex/tenancy'
import { expect, test, type Page } from './test'
import { Fixtures, SHOP, requireApp } from '../lib'

// What the storefront's consent runtime puts on the page (templates/storefront/src/runtime/consent.ts)
declare global {
  interface Window {
    shopnexConsent: {
      asks: boolean
      get(): { analytics: boolean; marketing: boolean }
      choice(): { analytics: boolean; marketing: boolean } | null
      accept(): void
    }
  }
}

const STOREFRONT_URL = (process.env.STOREFRONT_URL ?? 'http://localhost:4321').replace(/\/$/, '')
const fx = new Fixtures()
let original: boolean

// A tag a merchant would add to their theme: it counts how many times it ran
const GATED = `<script type="text/plain" data-consent="analytics">window.__tagRan = (window.__tagRan || 0) + 1</script>`
const BOTH = `<script type="text/plain" data-consent="analytics,marketing">window.__bothRan = true</script>`

test.beforeAll(async () => {
  await requireApp()
  await fx.init()
  original = (await getShopById(SHOP))!.cookieBanner
})

test.afterAll(async () => {
  await updateShop(SHOP, { cookieBanner: original })
  await fx.cleanup()
})

/** The storefront home with the two tags added before </body>, as if they were in the theme */
async function openStorefront(page: Page) {
  await page.route(`${STOREFRONT_URL}/`, async (route) => {
    const response = await route.fetch()
    const body = (await response.text()).replace('</body>', `${GATED}${BOTH}</body>`)
    await route.fulfill({ response, body })
  })
  await page.goto(`${STOREFRONT_URL}/`)
}

const ran = (page: Page) => page.evaluate(() => (window as never as { __tagRan?: number }).__tagRan ?? 0)
const banner = (page: Page) => page.getByRole('dialog', { name: 'Cookie settings' })

test.describe('banner on', () => {
  test.beforeEach(async () => {
    await updateShop(SHOP, { cookieBanner: true })
  })

  test('asks first: the tags stay off, rejecting is as easy as accepting, and no cookie is set', async ({
    page,
    context,
  }) => {
    await openStorefront(page)
    await expect(page.locator('meta[name="shopnex-consent"]')).toHaveAttribute('content', 'banner')
    await expect(banner(page)).toBeVisible()
    const accept = banner(page).getByRole('button', { name: 'Accept all' })
    const reject = banner(page).getByRole('button', { name: 'Reject all' })
    await expect(accept).toBeVisible()
    await expect(reject).toBeVisible()
    // Same size: refusing is not harder than agreeing
    const [a, r] = [await accept.boundingBox(), await reject.boundingBox()]
    expect(Math.abs(a!.height - r!.height)).toBeLessThan(2)
    expect(Math.abs(a!.width - r!.width)).toBeLessThan(4)

    expect(await ran(page)).toBe(0)
    expect(await context.cookies()).toEqual([])
  })

  test('accepting runs the tags, is remembered for the next page, and sets no cookie', async ({ page, context }) => {
    await openStorefront(page)
    await banner(page).getByRole('button', { name: 'Accept all' }).click()
    await expect(banner(page)).toHaveCount(0)
    expect(await ran(page)).toBe(1)
    await expect.poll(() => page.evaluate(() => (window as never as { __bothRan?: boolean }).__bothRan)).toBe(true)

    // Next page: not asked again, and the tags run as the page loads
    await page.reload()
    await expect(banner(page)).toHaveCount(0)
    expect(await ran(page)).toBe(1)
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('shopnex_consent')!).analytics)).toBe(true)
    expect(await context.cookies()).toEqual([])
  })

  test('rejecting keeps the tags off, now and on the next page', async ({ page }) => {
    await openStorefront(page)
    await banner(page).getByRole('button', { name: 'Reject all' }).click()
    await expect(banner(page)).toHaveCount(0)
    expect(await ran(page)).toBe(0)

    await page.reload()
    await expect(banner(page)).toHaveCount(0)
    expect(await ran(page)).toBe(0)
    expect(await page.evaluate(() => window.shopnexConsent.get())).toEqual({ analytics: false, marketing: false })
  })

  test('a visitor can change their mind from a Cookie settings link, and withdrawing takes effect on reload', async ({
    page,
  }) => {
    await openStorefront(page)
    await banner(page).getByRole('button', { name: 'Accept all' }).click()
    expect(await ran(page)).toBe(1)

    await page.evaluate(() => {
      const link = document.createElement('a')
      link.href = '#'
      link.textContent = 'Cookie settings'
      link.setAttribute('data-shopnex-consent-settings', '')
      document.body.append(link)
    })
    await page.getByRole('link', { name: 'Cookie settings' }).click()
    await expect(banner(page)).toBeVisible()

    // Withdrawing: a tag that already ran cannot be taken back, so the page reloads without it
    const reloaded = page.waitForEvent('load')
    await banner(page).getByRole('button', { name: 'Reject all' }).click()
    await reloaded
    await expect(banner(page)).toHaveCount(0)
    expect(await ran(page)).toBe(0)
  })

  test('pages and themes can read the choice and follow it', async ({ page }) => {
    await openStorefront(page)
    expect(await page.evaluate(() => window.shopnexConsent.asks)).toBe(true)
    expect(await page.evaluate(() => window.shopnexConsent.choice())).toBeNull()

    const heard = page.evaluate(
      () =>
        new Promise((resolve) =>
          document.addEventListener('shopnex:consent', (e) => resolve((e as CustomEvent).detail)),
        ),
    )
    await page.evaluate(() => window.shopnexConsent.accept())
    expect(await heard).toEqual({ analytics: true, marketing: true })
  })
})

test('banner off: nobody is asked and the tags run at once', async ({ page }) => {
  await updateShop(SHOP, { cookieBanner: false })
  await openStorefront(page)
  await expect(page.locator('meta[name="shopnex-consent"]')).toHaveAttribute('content', 'off')
  await expect(banner(page)).toHaveCount(0)
  expect(await page.evaluate(() => window.shopnexConsent.asks)).toBe(false)
  expect(await ran(page)).toBe(1)
  await expect.poll(() => page.evaluate(() => (window as never as { __bothRan?: boolean }).__bothRan)).toBe(true)
})

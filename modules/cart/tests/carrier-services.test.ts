import type { Conn } from '@shopnex/db'
// Carrier services: apps that quote shipping at checkout. Registering one (on the app's own origin only), staff renaming or switching it
// off, which apps could still be installed, and asking the services for rates: the signed request, what is accepted of the answer, and that
// a slow, failing or invalid app only means no rates from it.
import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { after, before, beforeEach, describe, test } from 'node:test'
import { apps } from '@shopnex/core/schema'
import { appInstallations } from '@shopnex/apps/schema'
import * as fx from './fixtures'
import { carrierServices } from '../src/cart.schema'

const { db, eq, SHOP, OTHER_SHOP } = fx
const { carrierService, CartError } = await import('../src')

const refused = (code: string) => (e: unknown) => e instanceof CartError && e.code === code
const MISSING = '00000000-0000-4000-8000-000000000000'

// ── a fake carrier app on localhost
let server: Server
let origin = ''
const requests: {
  url: string
  headers: Record<string, string | string[] | undefined>
  body: Record<string, unknown>
}[] = []
let answer: (url: string) => { status: number; body: unknown } = () => ({ status: 200, body: { rates: [] } })

before(async () => {
  await fx.prepareDatabase()
  await fx.otherShop()
  server = createServer(async (req, res) => {
    let body = ''
    for await (const chunk of req) body += chunk
    requests.push({
      url: req.url ?? '',
      headers: req.headers,
      body: body ? (JSON.parse(body) as Record<string, unknown>) : {},
    })
    const a = answer(req.url ?? '')
    res
      .writeHead(a.status, { 'content-type': 'application/json' })
      .end(typeof a.body === 'string' ? a.body : JSON.stringify(a.body))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
beforeEach(async () => {
  await fx.cleanup()
  requests.length = 0
  answer = () => ({ status: 200, body: { rates: [] } })
})
after(async () => {
  await fx.cleanup()
  await new Promise((resolve) => server.close(resolve))
})

async function carrierApp(patch: Partial<typeof apps.$inferInsert> = {}) {
  const [row] = await db
    .insert(apps)
    .values({
      name: 'Carrier',
      appUrl: `${origin}/app`,
      redirectUrls: [],
      scopes: ['write_shipping'],
      clientId: `app_carrier_${fx.unique()}`,
      ...patch,
    })
    .returning()
  fx.trackApp(row!.id)
  return row!
}

const input = (patch: Partial<Parameters<typeof carrierService.quote>[1]> = {}) => ({
  currency: 'USD',
  subtotalCents: 4000,
  destination: {
    countryCode: 'us',
    province: null,
    city: 'Somewhere',
    zip: '12345',
    address1: '1 Main St',
    address2: null,
  },
  items: [{ sku: 'TEE-1', fulfilledBy: null, title: 'Tee', quantity: 2, priceCents: 2000 }],
  ...patch,
})
const configured = async (opts: { name?: string; ready?: boolean; shopId?: string; path?: string } = {}) => {
  const app = await carrierApp()
  const service = await carrierService.configure(
    opts.shopId ?? SHOP,
    app.id,
    {
      name: opts.name ?? 'Carrier',
      ratesUrl: `${origin}${opts.path ?? '/rates'}`,
      ready: opts.ready ?? true,
    },
    db,
  )
  return { app, service }
}

describe('registering a service', () => {
  test('creates it for the shop with the name, the rates URL and whether it is ready; on for staff', async () => {
    const app = await carrierApp()
    const s = await carrierService.configure(
      SHOP,
      app.id,
      {
        name: 'Carrier',
        ratesUrl: `${origin}/rates`,
        ready: false,
      },
      db,
    )
    assert.deepEqual(
      [s.shopId, s.appId, s.name, s.ratesUrl, s.ready, s.active],
      [SHOP, app.id, 'Carrier', `${origin}/rates`, false, true],
    )
  })

  test('registering again updates the same service and keeps the name and switch staff chose', async () => {
    const { app, service } = await configured({ name: 'Original' })
    await carrierService.update(SHOP, service.id, { name: 'Renamed', active: false }, db)
    const again = await carrierService.configure(
      SHOP,
      app.id,
      {
        name: 'Ignored',
        ratesUrl: `${origin}/v2/rates`,
        ready: false,
      },
      db,
    )
    assert.deepEqual(
      [again.id, again.name, again.active, again.ratesUrl, again.ready],
      [service.id, 'Renamed', false, `${origin}/v2/rates`, false],
    )
    assert.equal((await db.select().from(carrierServices).where(eq(carrierServices.shopId, SHOP))).length, 1)
  })

  test('one service per app and shop: the same app in another shop gets its own', async () => {
    const app = await carrierApp()
    const a = await carrierService.configure(SHOP, app.id, { name: 'A', ratesUrl: `${origin}/rates`, ready: true }, db)
    const b = await carrierService.configure(
      OTHER_SHOP,
      app.id,
      {
        name: 'A',
        ratesUrl: `${origin}/rates`,
        ready: true,
      },
      db,
    )
    assert.notEqual(a.id, b.id)
  })

  test('the rates URL must be on the app’s own origin: another host, another port, another scheme or nonsense is INVALID_RATES_URL', async () => {
    const app = await carrierApp()
    for (const ratesUrl of [
      'https://evil.example.com/rates',
      `http://127.0.0.1:1/rates`,
      origin.replace('http:', 'https:') + '/rates',
      'not a url',
      'ftp://127.0.0.1/rates',
      '/relative',
    ])
      await assert.rejects(
        carrierService.configure(SHOP, app.id, { name: 'X', ratesUrl, ready: true }, db),
        refused('INVALID_RATES_URL'),
        ratesUrl,
      )
    assert.equal((await carrierService.list(SHOP, {}, db)).length, 0)
  })

  test('an app that does not exist is NOT_A_CARRIER_APP', async () => {
    await assert.rejects(
      carrierService.configure(SHOP, MISSING, { name: 'X', ratesUrl: `${origin}/rates`, ready: true }, db),
      refused('NOT_A_CARRIER_APP'),
    )
  })

  test('the rate id of a carrier rate is recognised by its prefix', () => {
    assert.equal(carrierService.isCarrierRateId('carrier:abc:fast'), true)
    assert.equal(carrierService.isCarrierRateId('3f2a1c9e-0000-4000-8000-000000000000'), false)
  })
})

describe('the shop’s services', () => {
  test('list is the shop’s own, oldest first; usableOnly leaves out the switched-off and the not ready', async () => {
    const { service: a } = await configured({ name: 'A' })
    const { service: b } = await configured({ name: 'B', ready: false })
    const { service: c } = await configured({ name: 'C' })
    await configured({ name: 'Theirs', shopId: OTHER_SHOP })
    await carrierService.update(SHOP, c.id, { active: false }, db)
    assert.deepEqual(
      (await carrierService.list(SHOP, {}, db)).map((s) => s.id),
      [a.id, b.id, c.id],
    )
    assert.deepEqual(
      (await carrierService.list(SHOP, { usableOnly: true }, db)).map((s) => s.id),
      [a.id],
    )
  })

  test('update renames or switches off; null for an unknown service or another shop’s', async () => {
    const { service } = await configured()
    const u = await carrierService.update(SHOP, service.id, { name: 'Renamed' }, db)
    assert.deepEqual([u?.name, u?.active], ['Renamed', true])
    assert.equal((await carrierService.update(SHOP, service.id, { active: false }, db))?.active, false)
    assert.equal(await carrierService.update(SHOP, MISSING, { name: 'x' }, db), null)
    assert.equal(await carrierService.update(OTHER_SHOP, service.id, { name: 'Hijacked' }, db), null)
  })
})

describe('apps that could be installed', () => {
  test('those that may quote shipping, are not also product importers, are not delisted and are not installed in this shop', async () => {
    const quoting = await carrierApp({ name: 'Quoting' })
    await carrierApp({ name: 'Importer', scopes: ['write_shipping', 'write_products'] })
    await carrierApp({ name: 'No shipping', scopes: ['read_orders'] })
    await carrierApp({ name: 'Delisted', delistedAt: new Date() })
    const installed = await carrierApp({ name: 'Installed' })
    await db.insert(appInstallations).values({ appId: installed.id, shopId: SHOP, scopes: ['write_shipping'] })
    const available = await carrierService.availableApps(SHOP, db)
    assert.deepEqual(
      available.map((a) => a.name),
      ['Quoting'],
    )
    assert.deepEqual(
      [available[0]?.id, available[0]?.clientId, available[0]?.appUrl],
      [quoting.id, quoting.clientId, quoting.appUrl],
    )
    const elsewhere = await carrierService.availableApps(OTHER_SHOP, db)
    assert.deepEqual(
      elsewhere.map((a) => a.name).sort(),
      ['Installed', 'Quoting'],
      'installed in one shop is still on offer in another',
    )
  })

  test('an uninstalled app is on offer again', async () => {
    const app = await carrierApp({ name: 'Back' })
    await db.insert(appInstallations).values({ appId: app.id, shopId: SHOP, scopes: [], uninstalledAt: new Date() })
    assert.deepEqual(
      (await carrierService.availableApps(SHOP, db)).map((a) => a.name),
      ['Back'],
    )
  })
})

describe('asking for rates', () => {
  const rate = (code: string, priceCents: number, extra: Record<string, unknown> = {}) => ({
    code,
    name: `Rate ${code}`,
    priceCents,
    ...extra,
  })

  test('every usable service is asked with a signed request about the cart and the destination; the cheapest rate comes first', async () => {
    const { service } = await configured({ name: 'Fast Freight' })
    answer = () => ({
      status: 200,
      body: { rates: [rate('slow', 900, { description: '  Tracked  ' }), rate('fast', 400)] },
    })
    const rates = await carrierService.quote(SHOP, input(), db)
    assert.deepEqual(
      rates.map((r) => [r.id, r.title, r.priceCents, r.description, r.carrier]),
      [
        [`carrier:${service.id}:fast`, 'Rate fast', 400, null, 'Fast Freight'],
        [`carrier:${service.id}:slow`, 'Rate slow', 900, 'Tracked', 'Fast Freight'],
      ],
    )
    assert.equal(requests.length, 1)
    const sent = requests[0]!
    assert.equal(sent.url, '/rates')
    assert.ok(
      Object.keys(sent.headers).some((h) => /signature/i.test(h)),
      'signed',
    )
    assert.deepEqual(
      { ...sent.body, id: typeof sent.body.id, instance: typeof sent.body.instance },
      {
        kind: 'rates',
        id: 'string',
        instance: 'string',
        shopId: SHOP,
        currency: 'USD',
        subtotalCents: 4000,
        destination: {
          countryCode: 'us',
          province: null,
          city: 'Somewhere',
          zip: '12345',
          address1: '1 Main St',
          address2: null,
        },
        items: [{ sku: 'TEE-1', fulfilledBy: null, title: 'Tee', quantity: 2, priceCents: 2000 }],
      },
    )
  })

  test('rates from several services are put together, cheapest first', async () => {
    await configured({ name: 'One' })
    await configured({ name: 'Two' })
    let n = 0
    answer = () => ({ status: 200, body: { rates: [rate('r', ++n === 1 ? 700 : 300)] } })
    const rates = await carrierService.quote(SHOP, input(), db)
    assert.deepEqual(
      rates.map((r) => r.priceCents),
      [300, 700],
    )
    assert.equal(requests.length, 2)
  })

  test('a service that is switched off, not ready, or another shop’s is not asked', async () => {
    const { service: off } = await configured({ name: 'Off' })
    await carrierService.update(SHOP, off.id, { active: false }, db)
    await configured({ name: 'Not ready', ready: false })
    await configured({ name: 'Theirs', shopId: OTHER_SHOP })
    answer = () => ({ status: 200, body: { rates: [rate('r', 100)] } })
    assert.deepEqual(await carrierService.quote(SHOP, input(), db), [])
    assert.equal(requests.length, 0)
  })

  test('without a destination country nobody is asked', async () => {
    await configured()
    answer = () => ({ status: 200, body: { rates: [rate('r', 100)] } })
    assert.deepEqual(
      await carrierService.quote(
        SHOP,
        input({
          destination: { countryCode: '', province: null, city: null, zip: null, address1: null, address2: null },
        }),
        db,
      ),
      [],
    )
    assert.equal(requests.length, 0)
  })

  test('only well-formed rates are taken: a code, a name, a whole non-negative price within a million, each code once, at most 20', async () => {
    await configured()
    const good = rate('ok', 100)
    const many = Array.from({ length: 25 }, (_, i) => rate(`m${String(i)}`, 1000 + i))
    answer = () => ({
      status: 200,
      body: {
        rates: [
          good,
          rate('ok', 50),
          rate('', 100),
          rate('x'.repeat(101), 100),
          { code: 'noname', priceCents: 100 },
          { code: 'blankname', name: '   ', priceCents: 100 },
          { code: 'longname', name: 'n'.repeat(201), priceCents: 100 },
          rate('negative', -1),
          rate('fraction', 10.5),
          rate('text', '100' as unknown as number),
          rate('huge', 100_000_001),
          rate('free', 0),
          rate('max', 100_000_000),
          null,
          'nonsense',
        ],
      },
    })
    const rates = await carrierService.quote(SHOP, input(), db)
    assert.deepEqual(
      rates.map((r) => r.id.split(':')[2]),
      ['free', 'ok', 'max'],
    )
    answer = () => ({ status: 200, body: { rates: many } })
    assert.equal((await carrierService.quote(SHOP, input(), db)).length, 20)
  })

  test('a long description is cut to 300 characters and a blank one is none', async () => {
    await configured()
    answer = () => ({
      status: 200,
      body: {
        rates: [
          rate('a', 100, { description: 'd'.repeat(500) }),
          rate('b', 200, { description: '   ' }),
          rate('c', 300, { description: 42 }),
        ],
      },
    })
    const rates = await carrierService.quote(SHOP, input(), db)
    assert.deepEqual(
      rates.map((r) => r.description?.length ?? null),
      [300, null, null],
    )
  })

  test('an app that fails, answers badly or is too chatty gives no rates, and the others still do', async () => {
    await configured({ name: 'Broken', path: '/rates/broken' })
    for (const bad of [
      { status: 500, body: 'oops' },
      { status: 200, body: 'not json' },
      { status: 200, body: { rates: 'none' } },
      { status: 200, body: { nothing: true } },
      { status: 200, body: 'null' },
      { status: 200, body: { rates: [rate('r', 1)], padding: 'x'.repeat(300 * 1024) } },
    ]) {
      answer = (url) => (url === '/rates/broken' ? bad : { status: 200, body: { rates: [] } })
      assert.deepEqual(await carrierService.quote(SHOP, input(), db), [], JSON.stringify(bad).slice(0, 60))
    }
    const { service } = await configured({ name: 'Working', path: '/rates/working' })
    // Both services are asked at once, so each answers by its own URL, never by who arrives first
    answer = (url) =>
      url === '/rates/broken' ? { status: 500, body: 'down' } : { status: 200, body: { rates: [rate('ok', 100)] } }
    const rates = await carrierService.quote(SHOP, input(), db)
    assert.deepEqual(
      rates.map((r) => r.id),
      [`carrier:${service.id}:ok`],
    )
  })

  test('an app that cannot be reached gives no rates', async () => {
    const app = await carrierApp({ appUrl: 'http://127.0.0.1:1/app' })
    await carrierService.configure(
      SHOP,
      app.id,
      { name: 'Gone', ratesUrl: 'http://127.0.0.1:1/rates', ready: true },
      db,
    )
    assert.deepEqual(await carrierService.quote(SHOP, input(), db), [])
  })
})

// Custom fields end to end: staff define them, tokens and staff set values, the storefront shows only the fields
// marked for it, wrong values are refused, and deleting a definition deletes its values.
import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { eq } from 'drizzle-orm'
import { db, schema } from '@shopnex/db'
import { Fixtures, SHOP, call, closeDb, ok, requireApp, sellableVariants } from '../lib'

const fx = new Fixtures()
const run = Date.now().toString(36)
const key = (name: string) => `${name}_${run}`.slice(0, 40)

let owner: Awaited<ReturnType<Fixtures['account']>>
let token: Record<string, string>
let readOnly: Record<string, string>
let otherToken: Record<string, string>
let storefront: Record<string, string>
const defs: Record<string, { id: string; key: string }> = {}
const productIds: string[] = []
const customerIds: string[] = []

const define = (body: Record<string, unknown>, as: Record<string, string> = owner.headers) =>
  call('POST', '/admin/custom-fields', body, as)

before(async () => {
  await requireApp()
  await fx.init()
  owner = await fx.account('owner')
  token = await fx.token(['write_products', 'write_customers', 'write_orders'])
  readOnly = await fx.token(['read_products'])
  otherToken = await fx.token(['write_products'], (await fx.shop()).id)
  storefront = { 'x-shopnex-key': (await fx.storefrontKey(SHOP)).token }

  const fields = [
    ['material', 'product', 'Material', 'text', true],
    ['internal_code', 'product', 'Internal code', 'text', false],
    ['weight_kg', 'product', 'Weight (kg)', 'number', true],
    ['organic', 'product', 'Organic', 'boolean', true],
    ['size', 'product', 'Size', 'choice', true],
    ['manual', 'product', 'Manual', 'file', true],
    ['vip_level', 'customer', 'VIP level', 'number', true],
    ['gift_note', 'order', 'Gift note', 'text', true],
  ] as const
  for (const [name, resource, label, type, storefront] of fields) {
    const d = ok(
      await define({
        resource,
        key: key(name),
        label,
        type,
        storefront,
        ...(type === 'choice' && { options: ['S', 'M', 'L'] }),
      }),
    )
    defs[name] = { id: d.id, key: d.key }
  }
})

after(async () => {
  if (productIds.length) await call('DELETE', '/admin/products/bulk', { ids: productIds }, token)
  if (customerIds.length) await call('DELETE', '/admin/customers/bulk', { ids: customerIds }, token)
  for (const d of Object.values(defs))
    await db.delete(schema.customFieldDefinitions).where(eq(schema.customFieldDefinitions.id, d.id))
  await fx.cleanup()
  await closeDb()
})

const k = (name: string) => defs[name]!.key

async function newProduct(customFields?: Record<string, unknown>) {
  const p = ok(
    await call('POST', '/admin/products', { title: `E2E fields ${run}`, priceCents: 1500, customFields }, token),
  )
  productIds.push(p.id)
  return p
}

describe('definitions', () => {
  test('staff define fields; a token can read them but not change them', async () => {
    const list = ok(await call('GET', '/admin/custom-fields?resource=customer', undefined, readOnly))
    assert.deepEqual(
      list.map((d: any) => d.key),
      [k('vip_level')],
    )
    assert.equal(
      (await define({ resource: 'product', key: key('nope'), label: 'No', type: 'text' }, readOnly)).status,
      401,
    )
    assert.equal((await call('PATCH', `/admin/custom-fields/${defs.material!.id}`, { label: 'x' }, token)).status, 401)
    assert.equal((await call('DELETE', `/admin/custom-fields/${defs.material!.id}`, undefined, token)).status, 401)
  })

  test('a key is unique per shop and resource, and looks like an identifier', async () => {
    assert.equal((await define({ resource: 'product', key: k('material'), label: 'Again', type: 'text' })).status, 409)
    // The same key on another resource is fine
    const other = ok(await define({ resource: 'order', key: k('material'), label: 'Again', type: 'text' }))
    await call('DELETE', `/admin/custom-fields/${other.id}`, undefined, owner.headers)
    for (const bad of ['Material', '1abc', 'with-dash', '']) {
      assert.equal((await define({ resource: 'product', key: bad, label: 'Bad', type: 'text' })).status, 400, bad)
    }
  })

  test('the label and storefront switch change; the key and type do not', async () => {
    const d = ok(await define({ resource: 'product', key: key('temp'), label: 'Temp', type: 'text' }))
    const patched = ok(
      await call('PATCH', `/admin/custom-fields/${d.id}`, { label: 'Renamed', storefront: true }, owner.headers),
    )
    assert.equal(patched.label, 'Renamed')
    assert.equal(patched.storefront, true)
    const typeChange = await call(
      'PATCH',
      `/admin/custom-fields/${d.id}`,
      { type: 'number', key: 'other' },
      owner.headers,
    )
    const after = ok(await call('GET', '/admin/custom-fields?resource=product', undefined, owner.headers)).find(
      (f: any) => f.id === d.id,
    )
    assert.ok(typeChange.status < 500)
    assert.deepEqual([after.type, after.key], ['text', key('temp')])
    ok(await call('DELETE', `/admin/custom-fields/${d.id}`, undefined, owner.headers))
  })
})

describe('values', () => {
  test('a product keeps its values; an update changes only the keys it names and null clears one', async () => {
    const p = await newProduct({
      [k('material')]: 'Linen',
      [k('weight_kg')]: 1.5,
      [k('organic')]: true,
      [k('size')]: 'M',
    })
    assert.deepEqual(p.customFields, {
      [k('material')]: 'Linen',
      [k('weight_kg')]: 1.5,
      [k('organic')]: true,
      [k('size')]: 'M',
    })

    const next = ok(
      await call(
        'PATCH',
        `/admin/products/${p.id}`,
        { customFields: { [k('material')]: 'Cotton', [k('organic')]: null } },
        token,
      ),
    )
    assert.deepEqual(next.customFields, {
      [k('material')]: 'Cotton',
      [k('weight_kg')]: 1.5,
      [k('size')]: 'M',
    })
    // An update that doesn't mention custom fields leaves them alone
    const renamed = ok(await call('PATCH', `/admin/products/${p.id}`, { title: `E2E fields renamed ${run}` }, token))
    assert.equal(renamed.customFields[k('material')], 'Cotton')
  })

  test('a key without a definition, or a value of the wrong type, is refused and nothing is saved', async () => {
    const p = await newProduct({ [k('material')]: 'Wool' })
    const bad: Record<string, unknown>[] = [
      { unknown_field: 'x' },
      { [k('weight_kg')]: 'heavy' },
      { [k('organic')]: 'yes' },
      { [k('size')]: 'XXL' },
      { [k('size')]: 1 },
      { [k('manual')]: 'javascript:alert(1)' },
      { [k('manual')]: 'not a url' },
      { [k('material')]: 5 },
      { [k('material')]: 'x'.repeat(1001) },
      // An order field can't be set on a product
      { [k('gift_note')]: 'hi' },
    ]
    for (const customFields of bad) {
      const r = await call(
        'PATCH',
        `/admin/products/${p.id}`,
        { customFields: { [k('material')]: 'Changed', ...customFields } },
        token,
      )
      assert.equal(r.status, 400, JSON.stringify(customFields))
    }
    assert.equal(ok(await call('GET', `/admin/products/${p.id}`, undefined, token)).customFields[k('material')], 'Wool')
    assert.equal(
      (await call('POST', '/admin/products', { title: 'x', priceCents: 1, customFields: { nope: 1 } }, token)).status,
      400,
    )
  })

  test('customers and orders have their own fields', async () => {
    const customer = ok(
      await call(
        'POST',
        '/admin/customers',
        { email: fx.mail('fields'), name: 'Fields', customFields: { [k('vip_level')]: 3 } },
        token,
      ),
    )
    customerIds.push(customer.id)
    assert.deepEqual(customer.customFields, { [k('vip_level')]: 3 })
    const updated = ok(
      await call('PATCH', `/admin/customers/${customer.id}`, { customFields: { [k('vip_level')]: 4 } }, token),
    )
    assert.deepEqual(updated.customFields, { [k('vip_level')]: 4 })
    assert.equal(
      (await call('PATCH', `/admin/customers/${customer.id}`, { customFields: { [k('material')]: 'x' } }, token))
        .status,
      400,
    )

    const [variant] = await sellableVariants(1)
    const order = ok(
      await call(
        'POST',
        '/admin/orders',
        { email: fx.mail('order'), items: [{ variantId: variant!.id, quantity: 1 }] },
        token,
      ),
    )
    fx.order(order.id)
    assert.deepEqual(order.customFields, {})
    const saved = ok(
      await call('PATCH', `/admin/orders/${order.id}`, { customFields: { [k('gift_note')]: 'Happy birthday' } }, token),
    )
    assert.deepEqual(saved.customFields, { [k('gift_note')]: 'Happy birthday' })
    assert.deepEqual(ok(await call('GET', `/admin/orders/${order.id}`, undefined, token)).customFields, {
      [k('gift_note')]: 'Happy birthday',
    })
    assert.equal(
      (await call('PATCH', `/admin/orders/${order.id}`, { customFields: { [k('vip_level')]: 1 } }, token)).status,
      400,
    )
  })

  test('a token without write access to the resource can not set values', async () => {
    const p = await newProduct()
    const r = await call('PATCH', `/admin/products/${p.id}`, { customFields: { [k('material')]: 'x' } }, readOnly)
    assert.equal(r.status, 403)
  })

  test("another shop's token sees none of these fields and can not use their keys", async () => {
    assert.deepEqual(ok(await call('GET', '/admin/custom-fields', undefined, otherToken)), [])
    const r = await call(
      'POST',
      '/admin/products',
      { title: 'x', priceCents: 1, customFields: { [k('material')]: 'x' } },
      otherToken,
    )
    assert.equal(r.status, 400)
  })
})

describe('filtering', () => {
  test('products can be filtered by a custom field value, in the admin and on the storefront', async () => {
    const a = await newProduct({ [k('size')]: 'L', [k('internal_code')]: 'A1' })
    const b = await newProduct({ [k('size')]: 'S', [k('internal_code')]: 'B2' })
    for (const p of [a, b]) ok(await call('PATCH', `/admin/products/${p.id}`, { status: 'active' }, token))
    const ids = (r: any) => (r.items ?? r.nodes).map((x: any) => x.id)

    const admin = ok(await call('GET', `/admin/products?limit=100&customField[0]=${k('size')}:L`, undefined, token))
    assert.deepEqual(
      ids(admin).filter((id: string) => [a.id, b.id].includes(id)),
      [a.id],
    )
    // Several filters must all match; a private field can be filtered by staff
    const both = ok(
      await call(
        'GET',
        `/admin/products?limit=100&customField[0]=${k('size')}:L&customField[1]=${k('internal_code')}:B2`,
        undefined,
        token,
      ),
    )
    assert.deepEqual(
      ids(both).filter((id: string) => [a.id, b.id].includes(id)),
      [],
    )
    const priv = ok(
      await call('GET', `/admin/products?limit=100&customField[0]=${k('internal_code')}:B2`, undefined, token),
    )
    assert.ok(ids(priv).includes(b.id) && !ids(priv).includes(a.id))

    const shop = ok(
      await call('GET', `/storefront/products?first=100&customField[0]=${k('size')}:S`, undefined, storefront),
    )
    assert.deepEqual(
      ids(shop).filter((id: string) => [a.id, b.id].includes(id)),
      [b.id],
    )
  })

  test('the storefront can not filter by a private field, and an unknown key is refused', async () => {
    assert.equal(
      (await call('GET', `/storefront/products?first=5&customField[0]=${k('internal_code')}:B2`, undefined, storefront))
        .status,
      400,
    )
    assert.equal((await call('GET', '/admin/products?customField[0]=nope:1', undefined, token)).status, 400)
  })
})

describe('storefront', () => {
  test('the Storefront API shows only fields marked for the storefront, and only those with a value', async () => {
    const p = await newProduct({
      [k('material')]: 'Linen',
      [k('internal_code')]: 'SECRET-42',
      [k('weight_kg')]: 2,
      [k('organic')]: false,
    })
    ok(await call('PATCH', `/admin/products/${p.id}`, { status: 'active' }, token))
    const shown = ok(await call('GET', `/storefront/products/by-handle/${p.slug}`, undefined, storefront))
    assert.deepEqual(shown.customFields, { [k('material')]: 'Linen', [k('weight_kg')]: 2, [k('organic')]: false })
    assert.ok(!JSON.stringify(shown).includes('SECRET-42'))
    assert.ok(!JSON.stringify(shown).includes('internal_code'))

    const listed = ok(
      await call('GET', '/storefront/products?first=100&query=E2E%20fields', undefined, storefront),
    ).nodes.find((n: any) => n.id === p.id)
    assert.deepEqual(listed?.customFields, shown.customFields)
  })

  test('hiding a field from the storefront takes effect at once', async () => {
    const p = await newProduct({ [k('material')]: 'Hemp' })
    ok(await call('PATCH', `/admin/products/${p.id}`, { status: 'active' }, token))
    const get = async () =>
      ok(await call('GET', `/storefront/products/by-handle/${p.slug}`, undefined, storefront)).customFields
    assert.deepEqual(await get(), { [k('material')]: 'Hemp' })
    ok(await call('PATCH', `/admin/custom-fields/${defs.material!.id}`, { storefront: false }, owner.headers))
    assert.deepEqual(await get(), {})
    ok(await call('PATCH', `/admin/custom-fields/${defs.material!.id}`, { storefront: true }, owner.headers))
  })

  test('customer fields need a signed-in shopper', async () => {
    const r = await call('GET', '/storefront/customer', undefined, storefront)
    assert.equal(r.status, 401)
  })
})

describe('choice fields', () => {
  test('need options, take new ones and never lose one', async () => {
    assert.equal((await define({ resource: 'product', key: key('bad'), label: 'Bad', type: 'choice' })).status, 400)
    assert.equal(
      (await define({ resource: 'product', key: key('bad'), label: 'Bad', type: 'text', options: ['x'] })).status,
      400,
    )
    const id = defs.size!.id
    const grown = ok(
      await call('PATCH', `/admin/custom-fields/${id}`, { options: ['S', 'M', 'L', 'XL'] }, owner.headers),
    )
    assert.deepEqual(grown.options, ['S', 'M', 'L', 'XL'])
    assert.equal(
      (await call('PATCH', `/admin/custom-fields/${id}`, { options: ['S', 'M'] }, owner.headers)).status,
      400,
    )
    const p = await newProduct({ [k('size')]: 'XL' })
    assert.equal(p.customFields[k('size')], 'XL')
  })
})

describe('deleting a field', () => {
  test('removes the values stored under its key and leaves the others', async () => {
    const d = ok(await define({ resource: 'product', key: key('gone'), label: 'Gone', type: 'text' }))
    const p = await newProduct({ [key('gone')]: 'bye', [k('material')]: 'Silk' })
    ok(await call('DELETE', `/admin/custom-fields/${d.id}`, undefined, owner.headers))
    assert.deepEqual(ok(await call('GET', `/admin/products/${p.id}`, undefined, token)).customFields, {
      [k('material')]: 'Silk',
    })
    // The key can be defined again, with nothing left over from before
    const again = ok(await define({ resource: 'product', key: key('gone'), label: 'Gone', type: 'number' }))
    assert.equal(
      ok(await call('GET', `/admin/products/${p.id}`, undefined, token)).customFields[key('gone')],
      undefined,
    )
    await call('DELETE', `/admin/custom-fields/${again.id}`, undefined, owner.headers)
  })
})

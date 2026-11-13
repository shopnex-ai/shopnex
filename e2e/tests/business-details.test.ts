// The business details printed on invoices (legal name, address, VAT number): who can set them, what is kept, and what is
// refused. The invoice page itself is in browser/invoice.spec.ts. Puts the shop's details back at the end.
import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { getShopById, updateShop } from '@shopnex/tenancy'
import { Fixtures, SHOP, call, closeDb, ok, requireApp } from '../lib'

const fx = new Fixtures()
let owner: Record<string, string>
let member: Record<string, string>
let original: NonNullable<Awaited<ReturnType<typeof getShopById>>>

before(async () => {
  await requireApp()
  await fx.init()
  original = (await getShopById(SHOP))!
  owner = (await fx.account('owner')).headers
  member = (await fx.account('member')).headers
})

after(async () => {
  await updateShop(SHOP, {
    legalName: original.legalName,
    businessAddress: original.businessAddress,
    taxId: original.taxId,
  })
  await fx.cleanup()
  await closeDb()
})

const patch = (body: object, headers = owner) => call('PATCH', '/admin/shop', body, headers)

describe('business details', () => {
  test('an owner sets them, they are trimmed, and the shop answers with them', async () => {
    const saved = ok(
      await patch({
        legalName: '  E2E Trading GmbH ',
        businessAddress: ' Teststrasse 1\n10115 Berlin\nGermany ',
        taxId: ' DE123456789 ',
      }),
    )
    assert.equal(saved.legalName, 'E2E Trading GmbH')
    assert.equal(saved.businessAddress, 'Teststrasse 1\n10115 Berlin\nGermany', 'the line breaks stay')
    assert.equal(saved.taxId, 'DE123456789')

    const shop = ok(await call('GET', '/admin/shop', undefined, owner))
    assert.equal(shop.legalName, 'E2E Trading GmbH')
    assert.equal(shop.taxId, 'DE123456789')
  })

  test('they can be cleared, and changing one leaves the others', async () => {
    ok(await patch({ legalName: 'Keep Me', businessAddress: 'One Street', taxId: 'XX1' }))
    const changed = ok(await patch({ taxId: 'XX2' }))
    assert.deepEqual([changed.legalName, changed.businessAddress, changed.taxId], ['Keep Me', 'One Street', 'XX2'])

    const cleared = ok(await patch({ legalName: null, businessAddress: null, taxId: null }))
    assert.deepEqual([cleared.legalName, cleared.businessAddress, cleared.taxId], [null, null, null])
  })

  test('values that are too long are refused and nothing is saved', async () => {
    ok(await patch({ legalName: 'Before', taxId: 'T1' }))
    for (const body of [
      { legalName: 'x'.repeat(151) },
      { businessAddress: 'x'.repeat(501) },
      { taxId: 'x'.repeat(51) },
    ]) {
      const res = await patch(body)
      assert.equal(res.status, 400, JSON.stringify(body).slice(0, 40))
    }
    const shop = ok(await call('GET', '/admin/shop', undefined, owner))
    assert.deepEqual([shop.legalName, shop.taxId], ['Before', 'T1'])
  })

  test('staff cannot change them', async () => {
    const res = await patch({ taxId: 'HACKED' }, member)
    assert.ok(res.status === 403 || res.status === 401, `${res.status} ${JSON.stringify(res.body)}`)
    assert.notEqual((await getShopById(SHOP))!.taxId, 'HACKED')
  })

  test('without a session nothing can be changed', async () => {
    assert.equal((await patch({ taxId: 'HACKED' }, {})).status, 401)
  })
})

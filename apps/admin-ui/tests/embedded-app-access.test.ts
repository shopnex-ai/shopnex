import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { embeddedAppAccess } from '../src/screens/apps/access'

const session = { user: { id: 'user-1' } }
const tenant = (role: string, superAdmin = false) => ({ shop: { id: 'shop-1' }, role, superAdmin })

describe('embeddedAppAccess', () => {
  test('no session or no shop gets nothing', () => {
    assert.equal(embeddedAppAccess({ session: null, tenant: null }).status, 'none')
    assert.equal(embeddedAppAccess({ session: null, tenant: tenant('owner') }).status, 'none')
    assert.equal(embeddedAppAccess({ session, tenant: null }).status, 'none')
  })

  test('a member who is not an owner or admin is refused', () => {
    assert.equal(embeddedAppAccess({ session, tenant: tenant('member') }).status, 'forbidden')
    assert.equal(embeddedAppAccess({ session, tenant: { shop: { id: 'shop-1' } } }).status, 'forbidden')
  })

  test('owners, admins and super admins get the session user and the session shop', () => {
    for (const t of [tenant('owner'), tenant('admin'), tenant('member', true)]) {
      assert.deepEqual(embeddedAppAccess({ session, tenant: t }), { status: 'ok', shopId: 'shop-1', userId: 'user-1' })
    }
  })
})

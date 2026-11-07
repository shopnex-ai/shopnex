import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { managerAccess } from '../src/lib/admin-access'

const session = { user: { id: 'user-1' } }
const tenant = (role: string, superAdmin = false) => ({ shop: { id: 'shop-1' }, role, superAdmin })

describe('managerAccess', () => {
  test('no session or no shop gets nothing', () => {
    assert.equal(managerAccess({ session: null, tenant: null }).status, 'none')
    assert.equal(managerAccess({ session: null, tenant: tenant('owner') }).status, 'none')
    assert.equal(managerAccess({ session, tenant: null }).status, 'none')
  })

  test('a member who is not an owner or admin is refused', () => {
    assert.equal(managerAccess({ session, tenant: tenant('member') }).status, 'forbidden')
    assert.equal(managerAccess({ session, tenant: { shop: { id: 'shop-1' } } }).status, 'forbidden')
  })

  test('owners, admins and super admins get the session user and the session shop', () => {
    for (const t of [tenant('owner'), tenant('admin'), tenant('member', true)]) {
      assert.deepEqual(managerAccess({ session, tenant: t }), {
        status: 'ok',
        shop: { id: 'shop-1' },
        shopId: 'shop-1',
        userId: 'user-1',
      })
    }
  })
})

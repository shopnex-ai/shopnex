import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { bindConn } from '../src'

type Conn = { name: string }
const db: Conn = { name: 'shared' }
const service = {
  LIMIT: 20,
  list: (shopId: string, conn: Conn) => `${shopId}@${conn.name}`,
  rename: (shopId: string, id: string, name: string | undefined, conn: Conn) => [shopId, id, name, conn.name],
  count: (conn: Conn) => conn.name.length,
  async later(shopId: string, conn: Conn) {
    return Promise.resolve(`${shopId}:${conn.name}`)
  },
}

describe('bindConn', () => {
  test('fills in the connection as the last argument, whatever the others are', async () => {
    const bound = bindConn(service, db)
    assert.equal(bound.list('shop-1'), 'shop-1@shared')
    assert.deepEqual(bound.rename('shop-1', 'x', undefined), ['shop-1', 'x', undefined, 'shared'])
    assert.equal(bound.count(), 6)
    assert.equal(await bound.later('shop-1'), 'shop-1:shared')
  })

  test('leaves what is not a function as it is', () => {
    assert.equal(bindConn(service, db).LIMIT, 20)
  })

  test('the connection is no longer a parameter (checked by the compiler, never run)', () => {
    const bound = bindConn(service, db)
    const onlyTypeChecked = () => {
      // @ts-expect-error the connection is already bound
      bound.list('shop-1', db)
      // @ts-expect-error the shop is still needed
      bound.list()
    }
    assert.equal(typeof onlyTypeChecked, 'function')
  })

  test('a connection that is a transaction can be bound the same way', () => {
    const tx: Conn = { name: 'tx' }
    assert.equal(bindConn(service, tx).list('shop-1'), 'shop-1@tx')
  })
})

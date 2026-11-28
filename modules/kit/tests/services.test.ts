import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { defineServices, setDefaultConn, type ConnLike } from '../src'

type Named = ConnLike & { name: string }
const conn = (name: string): Named => ({ name, transaction: () => undefined })

// Plain functions the way a module writes them: the connection is the last argument
const menus = {
  list: (shopId: string, c: Named) => `${shopId}@${c.name}`,
  add: (shopId: string, title: string, c: Named) => `${shopId}/${title}@${c.name}`,
  limit: 5,
}

describe('defineServices', () => {
  test('before a default connection is registered, a call says what is missing', () => {
    const early = defineServices({ menus })
    assert.throws(() => (early.menus.list as (shopId: string) => string)('s1'), /No database connection is registered/)
  })

  test('the default connection is filled in as the last argument, at call time', () => {
    const services = defineServices({ menus })
    setDefaultConn(conn('shared'))
    assert.equal(services.menus.list('s1'), 's1@shared')
    assert.equal(services.menus.add('s1', 'Main'), 's1/Main@shared')
    setDefaultConn(conn('replaced'))
    assert.equal(services.menus.list('s1'), 's1@replaced', 'it is read when called, not when defined')
  })

  test('withConn uses the connection it is given (a transaction) and leaves the default alone', () => {
    const services = defineServices({ menus })
    setDefaultConn(conn('shared'))
    const inTx = services.withConn(conn('tx'))
    assert.equal(inTx.menus.list('s1'), 's1@tx')
    assert.equal(services.menus.list('s1'), 's1@shared')
  })

  test('values that are not functions, and a function without a connection stays callable; one with another last parameter is refused by the types', () => {
    const services = defineServices({ menus })
    setDefaultConn(conn('shared'))
    assert.equal(services.menus.limit, 5)
  })
})

// Type-level: the connection is taken away from `ok`; `notBound` has no connection to attach, so it is `never`
const mixed = defineServices({
  g: { ok: (a: string, c: ConnLike) => a + String(c), notBound: (a: string, b: number) => a + String(b) },
})
type IsNever<T> = [T] extends [never] ? true : false
export const bound: (a: string) => string = mixed.g.ok
export const unbound: IsNever<typeof mixed.g.notBound> = true

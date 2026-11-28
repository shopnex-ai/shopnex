// A module's services are plain functions that take the database connection as their last argument (so code inside a
// transaction passes its `tx`). `defineServices` groups them and attaches the connection once, so a route handler, a test or
// another module calls `content.menus.list(shopId)` without writing `db`, and `content.withConn(tx).menus.list(shopId)` inside a
// transaction. The default connection is registered by @shopnex/db when it creates the database, so kit knows nothing about it.

/** What a database connection or an open transaction looks like to this file; the real type is @shopnex/db's `Conn` */
export interface ConnLike {
  transaction: (...args: never[]) => unknown
}

/** A group of service functions with the trailing connection parameter taken away; everything else is left as it is */
export type Bound<S> = {
  [K in keyof S]: S[K] extends (...args: [...infer A, infer L]) => infer R
    ? [L] extends [ConnLike] // not distributive: `Db | Tx` is one connection, not two overloads
      ? (...args: A) => R
      : never // a function whose last parameter is not the connection can't be bound; call it from the raw module
    : S[K]
}

export type ServiceGroups = Record<string, object>
type BoundGroups<G extends ServiceGroups> = { [N in keyof G]: Bound<G[N]> }
export type Services<G extends ServiceGroups> = BoundGroups<G> & {
  /** The same services on another connection: an open transaction, usually */
  withConn: (conn: ConnLike) => BoundGroups<G>
}

const DEFAULT = Symbol.for('shopnex.defaultConn')
const registry = globalThis as unknown as Record<symbol, ConnLike | undefined>

/** Called once by @shopnex/db with the shared connection */
export function setDefaultConn(conn: ConnLike) {
  registry[DEFAULT] = conn
}

function defaultConn(): ConnLike {
  const conn = registry[DEFAULT]
  if (!conn) throw new Error('No database connection is registered: import @shopnex/db before calling a service')
  return conn
}

function bindGroup(group: object, connection: () => ConnLike) {
  const bound: Record<string, unknown> = {}
  for (const [name, member] of Object.entries(group)) {
    bound[name] =
      typeof member === 'function'
        ? (...args: unknown[]) => (member as (...all: unknown[]) => unknown)(...args, connection())
        : member
  }
  return bound
}

export function defineServices<const G extends ServiceGroups>(groups: G): Services<G> {
  const bindAll = (connection: () => ConnLike) =>
    Object.fromEntries(Object.entries(groups).map(([name, group]) => [name, bindGroup(group, connection)]))
  return {
    ...bindAll(defaultConn),
    withConn: (conn: ConnLike) => bindAll(() => conn),
  } as unknown as Services<G>
}

import { AsyncLocalStorage } from 'node:async_hooks'
import type { PGlite } from '@electric-sql/pglite'

/**
 * Turns a silent freeze of the embedded database into an error that says where.
 *
 * PGlite has ONE connection. A transaction holds it, so a query sent through the shared handle (`db`) while a
 * transaction is open waits for that transaction, and if the transaction is awaiting that query, both wait for ever:
 * every request that touches the database then hangs. The same goes for opening a new transaction on the shared handle
 * inside one (`db.transaction` inside `db.transaction`), which waits for the outer one to end. PostgreSQL gives both a
 * second pooled connection, so the same code works there and the mistake only shows on the embedded database, far from
 * its cause (a helper called inside the transaction that reads through `db`, or opens its own transaction).
 *
 * This remembers, per async call chain, that a transaction callback is running. Any query, or new transaction, made
 * through the shared handle inside that chain is the mistake: it fails at once with a message that names the outer
 * transaction's origin. Calls made on the transaction itself use another object and are never checked, and that
 * includes `tx.transaction(...)`, a savepoint.
 */
export type GuardMode = 'throw' | 'warn' | 'off'

/** SHOPNEX_DB_GUARD: `throw` (default), `warn` (log, keep going: it will still wait) or `off` */
export function guardMode(value = process.env.SHOPNEX_DB_GUARD): GuardMode {
  return value === 'warn' || value === 'off' ? value : 'throw'
}

type Open = { opened: string }

export class SharedHandleInTransactionError extends Error {
  constructor(method: string, opened: string) {
    const what = method === 'transaction' ? 'A new transaction was opened' : `A query (${method}) ran`
    const fix =
      method === 'transaction'
        ? 'Use the transaction you are in (tx.transaction(...) makes a savepoint), or open it before the outer db.transaction(...) starts.'
        : 'Run it on the transaction (tx), or do it before db.transaction(...) opens.'
    super(
      `${what} on the shared database handle inside a transaction. On the embedded database ` +
        `(one connection) it would wait for that transaction for ever and freeze the shop. ${fix}\n` +
        `The transaction was opened at:\n${opened}\n` +
        `(SHOPNEX_DB_GUARD=warn logs this instead of failing, off disables the check)`,
    )
    this.name = 'SharedHandleInTransactionError'
  }
}

export function guardEmbeddedClient(client: PGlite, mode: GuardMode = guardMode()) {
  if (mode === 'off') return client
  const inTransaction = new AsyncLocalStorage<Open>()

  /** Called before `method` runs on the shared handle: inside a transaction that is the mistake */
  const refuse = (method: string): Promise<never> | null => {
    const open = inTransaction.getStore()
    if (!open) return null
    const error = new SharedHandleInTransactionError(method, open.opened)
    if (mode === 'throw') return Promise.reject(error)
    console.error(`[db] ${error.message}\n${error.stack ?? ''}`)
    return null
  }

  const transaction = client.transaction.bind(client) as (
    callback: (tx: unknown) => Promise<unknown>,
  ) => Promise<unknown>
  Reflect.set(client, 'transaction', (callback: (tx: unknown) => Promise<unknown>) => {
    const refused = refuse('transaction')
    if (refused) return refused
    const open = { opened: (new Error().stack ?? '').split('\n').slice(2, 9).join('\n') }
    return transaction((tx) => inTransaction.run(open, () => callback(tx)))
  })

  for (const method of ['query', 'exec', 'sql'] as const) {
    const original = client[method].bind(client) as (...args: unknown[]) => Promise<unknown>
    Reflect.set(client, method, (...args: unknown[]) => refuse(method) ?? original(...args))
  }
  return client
}

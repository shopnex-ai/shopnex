import { AsyncLocalStorage } from 'node:async_hooks'
import type { PGlite } from '@electric-sql/pglite'

/**
 * Turns a silent freeze of the embedded database into an error that says where.
 *
 * PGlite has ONE connection. A transaction holds it, so a query sent through the shared handle (`db`) while a
 * transaction is open waits for that transaction, and if the transaction is awaiting that query, both wait for ever:
 * every request that touches the database then hangs. PostgreSQL gives the query a second pooled connection, so the
 * same code works there and the mistake only shows on the embedded database, far from its cause (a helper called
 * inside the transaction that reads through `db`).
 *
 * This remembers, per async call chain, that a transaction callback is running. Any query made through the shared
 * handle inside that chain is the mistake: it fails at once with a message that names the transaction's origin.
 * Queries made on the transaction itself use another object and are never checked.
 */
export type GuardMode = 'throw' | 'warn' | 'off'

/** SHOPNEX_DB_GUARD: `throw` (default), `warn` (log, keep going: it will still wait) or `off` */
export function guardMode(value = process.env.SHOPNEX_DB_GUARD): GuardMode {
  return value === 'warn' || value === 'off' ? value : 'throw'
}

type Open = { opened: string }

export class SharedHandleInTransactionError extends Error {
  constructor(method: string, opened: string) {
    super(
      `A query (${method}) ran on the shared database handle inside a transaction. On the embedded database ` +
        `(one connection) it would wait for that transaction for ever and freeze the shop. Run it on the transaction ` +
        `(tx), or do it before db.transaction(...) opens.\nThe transaction was opened at:\n${opened}\n` +
        `(SHOPNEX_DB_GUARD=warn logs this instead of failing, off disables the check)`,
    )
    this.name = 'SharedHandleInTransactionError'
  }
}

export function guardEmbeddedClient(client: PGlite, mode: GuardMode = guardMode()) {
  if (mode === 'off') return client
  const inTransaction = new AsyncLocalStorage<Open>()

  const transaction = client.transaction.bind(client) as (
    callback: (tx: unknown) => Promise<unknown>,
  ) => Promise<unknown>
  Reflect.set(client, 'transaction', (callback: (tx: unknown) => Promise<unknown>) => {
    const open = { opened: (new Error().stack ?? '').split('\n').slice(2, 9).join('\n') }
    return transaction((tx) => inTransaction.run(open, () => callback(tx)))
  })

  for (const method of ['query', 'exec', 'sql'] as const) {
    const original = client[method].bind(client) as (...args: unknown[]) => Promise<unknown>
    Reflect.set(client, method, (...args: unknown[]) => {
      const open = inTransaction.getStore()
      if (open) {
        const error = new SharedHandleInTransactionError(method, open.opened)
        if (mode === 'throw') return Promise.reject(error)
        console.error(`[db] ${error.message}\n${error.stack ?? ''}`)
      }
      return original(...args)
    })
  }
  return client
}

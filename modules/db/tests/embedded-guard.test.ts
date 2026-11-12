// The embedded database has one connection: a query on the shared handle inside a transaction waits for the
// transaction for ever. The guard turns that into an error at the offending query. These tests use a real in-memory
// PGlite through drizzle, the way the app does.
import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, mock, test } from 'node:test'
import { PGlite } from '@electric-sql/pglite'
import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/pglite'
import { SharedHandleInTransactionError, guardEmbeddedClient, guardMode, type GuardMode } from '../src/embedded-guard'

/** Fails the test instead of hanging it: a hang is the bug */
async function within<T>(ms: number, work: Promise<T>): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  const frozen = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`did not finish in ${ms} ms: the database is blocked`)), ms)
  })
  try {
    return await Promise.race([work, frozen])
  } finally {
    clearTimeout(timer)
  }
}

let client: PGlite | undefined
let db: ReturnType<typeof drizzle>

/** Drizzle wraps what a client call throws in a DrizzleQueryError: the guard's error is its cause */
const rootCause = (error: unknown) => (error instanceof Error && error.cause instanceof Error ? error.cause : error)

async function open(mode: GuardMode) {
  client = guardEmbeddedClient(new PGlite(), mode)
  db = drizzle({ client })
  await db.execute(sql`create table item (id serial primary key, name text not null)`)
}

afterEach(async () => {
  mock.restoreAll()
  await client?.close()
  client = undefined
})

const count = async (conn: Pick<typeof db, 'execute'>) =>
  Number(((await conn.execute(sql`select count(*) as n from item`)).rows[0] as { n: string }).n)

describe('guard on (the default)', () => {
  beforeEach(() => open('throw'))

  test('queries on the transaction itself work, and commit', async () => {
    await within(
      5000,
      db.transaction(async (tx) => {
        await tx.execute(sql`insert into item (name) values ('a')`)
        assert.equal(await count(tx), 1)
      }),
    )
    assert.equal(await count(db), 1)
  })

  test('a query on the shared handle inside a transaction fails at once instead of freezing', async () => {
    await assert.rejects(
      within(
        5000,
        db.transaction(async (tx) => {
          await tx.execute(sql`insert into item (name) values ('a')`)
          await db.execute(sql`select 1`)
        }),
      ),
      (error: Error) => {
        const cause = rootCause(error)
        assert.ok(cause instanceof SharedHandleInTransactionError, String(cause))
        assert.match(cause.message, /shared database handle inside a transaction/)
        assert.match(cause.message, /transaction was opened at/)
        return true
      },
    )
    // The failed transaction rolled back, and the database is usable
    assert.equal(await within(5000, count(db)), 0)
  })

  test('also when the query is made by a helper the transaction calls', async () => {
    const readSettings = async () => (await db.execute(sql`select 1 as one`)).rows[0]
    const helper = async () => readSettings()
    await assert.rejects(
      within(
        5000,
        db.transaction(async () => {
          await helper()
        }),
      ),
      (error: Error) => rootCause(error) instanceof SharedHandleInTransactionError,
    )
  })

  test('the error names where the transaction was opened', async () => {
    const error = await within(
      5000,
      db
        .transaction(async () => {
          await db.execute(sql`select 1`)
        })
        .then(
          () => null,
          (e: Error) => e,
        ),
    )
    assert.match(rootCause(error)?.message ?? '', /embedded-guard\.test\.ts/)
  })

  test('after the transaction ends, the shared handle works again', async () => {
    await db.transaction(async (tx) => {
      await tx.execute(sql`insert into item (name) values ('a')`)
    })
    assert.equal(await within(5000, count(db)), 1)
  })

  test('nested transactions (savepoints) use the transaction and work', async () => {
    await within(
      5000,
      db.transaction(async (tx) => {
        await tx.execute(sql`insert into item (name) values ('outer')`)
        await tx.transaction(async (inner) => {
          await inner.execute(sql`insert into item (name) values ('inner')`)
        })
        assert.equal(await count(tx), 2)
      }),
    )
    assert.equal(await count(db), 2)
  })

  test('another request querying at the same time is not blamed: it just waits its turn', async () => {
    let release!: () => void
    const held = new Promise<void>((resolve) => (release = resolve))
    const slow = db.transaction(async (tx) => {
      await tx.execute(sql`insert into item (name) values ('a')`)
      await held
    })
    // Started from outside the transaction's call chain, while the transaction is open
    const other = db.execute(sql`select count(*) as n from item`)
    release()
    await within(5000, slow)
    const rows = (await within(5000, other)).rows as { n: string }[]
    assert.equal(Number(rows[0]!.n), 1)
  })

  test('a new transaction opened on the shared handle inside a transaction fails at once instead of freezing', async () => {
    await assert.rejects(
      within(
        5000,
        db.transaction(async (tx) => {
          await tx.execute(sql`insert into item (name) values ('outer')`)
          await db.transaction(async () => {})
        }),
      ),
      (error: Error) => {
        const cause = rootCause(error)
        assert.ok(cause instanceof SharedHandleInTransactionError, String(cause))
        assert.match(cause.message, /A new transaction was opened on the shared database handle inside a transaction/)
        assert.match(cause.message, /tx\.transaction\(\.\.\.\) makes a savepoint/)
        assert.match(cause.message, /transaction was opened at/)
        return true
      },
    )
    // The outer transaction rolled back, and the database is usable
    assert.equal(await within(5000, count(db)), 0)
  })

  test('also when a helper the transaction calls opens its own transaction', async () => {
    const removeSomething = async () => db.transaction(async (tx) => tx.execute(sql`select 1`))
    await assert.rejects(
      within(
        5000,
        db.transaction(async () => {
          await removeSomething()
        }),
      ),
      (error: Error) => rootCause(error) instanceof SharedHandleInTransactionError,
    )
  })

  test('the error names the outer transaction, not the one that was refused', async () => {
    const error = await within(
      5000,
      db
        .transaction(async () => {
          await db.transaction(async () => {})
        })
        .then(
          () => null,
          (e: Error) => e,
        ),
    )
    assert.match(rootCause(error)?.message ?? '', /embedded-guard\.test\.ts/)
  })

  test('another request opening its own transaction at the same time is not blamed: it waits its turn', async () => {
    let release!: () => void
    const held = new Promise<void>((resolve) => (release = resolve))
    const first = db.transaction(async (tx) => {
      await tx.execute(sql`insert into item (name) values ('first')`)
      await held
    })
    // Started from outside the first transaction's call chain, while it is open
    const second = db.transaction(async (tx) => {
      await tx.execute(sql`insert into item (name) values ('second')`)
    })
    release()
    await within(5000, first)
    await within(5000, second)
    assert.equal(await count(db), 2)
  })

  test('a savepoint (tx.transaction) is still fine, and so is a transaction opened after the first ended', async () => {
    await within(
      5000,
      db.transaction(async (tx) => {
        await tx.transaction(async (inner) => {
          await inner.execute(sql`insert into item (name) values ('saved')`)
        })
      }),
    )
    await within(
      5000,
      db.transaction(async (tx) => {
        await tx.execute(sql`insert into item (name) values ('again')`)
      }),
    )
    assert.equal(await count(db), 2)
  })

  test('raw client calls made inside the transaction are caught too (query, exec, sql, transaction)', async () => {
    for (const run of [
      () => client.query('select 1'),
      () => client.exec('select 1'),
      () => client.sql`select 1`,
      () => client.transaction(async () => {}),
    ]) {
      await assert.rejects(
        within(
          5000,
          db.transaction(async () => {
            await run()
          }),
        ),
        (error: Error) => rootCause(error) instanceof SharedHandleInTransactionError,
      )
    }
  })
})

describe('guard in warn mode', () => {
  beforeEach(() => open('warn'))

  test('logs the mistake and lets a query that is not awaited finish after the transaction', async () => {
    const logged = mock.method(console, 'error', () => {})
    let late: Promise<unknown> | undefined
    await within(
      5000,
      db.transaction(async (tx) => {
        await tx.execute(sql`insert into item (name) values ('a')`)
        // Started but not awaited: it queues behind the transaction instead of deadlocking with it (drizzle only runs
        // a query once something calls .then on it)
        late = db.execute(sql`select count(*) as n from item`).then((result) => result)
      }),
    )
    await within(5000, late!)
    assert.equal(logged.mock.callCount(), 1)
    assert.match(String(logged.mock.calls[0]!.arguments[0]), /shared database handle inside a transaction/)
  })
})

describe('guard in warn mode, nested transaction', () => {
  beforeEach(() => open('warn'))

  test('logs it and lets a transaction that is not awaited run after the outer one ends', async () => {
    const logged = mock.method(console, 'error', () => {})
    let late: Promise<unknown> | undefined
    await within(
      5000,
      db.transaction(async (tx) => {
        await tx.execute(sql`insert into item (name) values ('outer')`)
        // Started but not awaited: it queues behind the outer transaction instead of deadlocking with it
        late = db.transaction(async (inner) => {
          await inner.execute(sql`insert into item (name) values ('late')`)
        })
      }),
    )
    await within(5000, late!)
    assert.equal(logged.mock.callCount(), 1)
    assert.match(
      String(logged.mock.calls[0]!.arguments[0]),
      /A new transaction was opened on the shared database handle/,
    )
    assert.equal(await count(db), 2)
  })
})

describe('guard off', () => {
  test('leaves the client untouched', async () => {
    const plain = new PGlite()
    const query = plain.query
    assert.equal(guardEmbeddedClient(plain, 'off').query, query)
    await plain.close()
  })
})

describe('guardMode', () => {
  test('is throw unless SHOPNEX_DB_GUARD says warn or off', () => {
    assert.equal(guardMode(undefined), 'throw')
    assert.equal(guardMode(''), 'throw')
    assert.equal(guardMode('nonsense'), 'throw')
    assert.equal(guardMode('warn'), 'warn')
    assert.equal(guardMode('off'), 'off')
  })
})

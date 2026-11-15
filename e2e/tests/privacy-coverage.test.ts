// A customer's export and erasure only cover the columns somebody remembered. This fails when a column that looks like
// personal data (an email, a phone number, an address, an IP address) appears in a table that is not accounted for
// below, so adding one forces a decision: handle it in modules/customers/src/privacy.ts, or say here why not.
// It reads the schema only: no server, no database.
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { getTableConfig } from 'drizzle-orm/pg-core'
import * as schema from '@shopnex/db/schema'

const LOOKS_PERSONAL = /email|phone|address|ip_address|user_agent|first_name|last_name/

/** Exported by `privacyService.exportData` and removed or anonymized by `privacyService.erase` */
const HANDLED: Record<string, string> = {
  'customers.email': 'the record: deleted',
  'customers.phone': 'the record: deleted',
  'orders.email': 'anonymized, the order stays as a record',
  'orders.phone': 'anonymized',
  'orders.shipping_address': 'anonymized; the country and region stay for tax',
  'orders.billing_address': 'anonymized; the country and region stay for tax',
  'carts.email': 'cleared',
  'user.email': "the storefront login: deleted with the customer unless it is staff's or another shop's",
  'session.ip_address': "deleted with the login's sessions",
  'session.user_agent': "deleted with the login's sessions",
}

/** Looks personal and is deliberately not erased with a customer */
const LEFT_ALONE: Record<string, string> = {
  'email_suppressions.email': 'the unsubscribe list stays after an erasure: it is how a "no" is honoured',
  'shop_invitations.email': 'an invitation to join the staff, not a customer',
  'shops.business_address': "the business's own address, printed on its invoices",
  'user.email_verified': 'a flag, personal data only together with the email next to it',
}

function personalColumns() {
  const found = new Set<string>()
  for (const value of Object.values(schema)) {
    let table: ReturnType<typeof getTableConfig>
    try {
      table = getTableConfig(value as never)
    } catch {
      continue // not a table (a type, an enum, a helper)
    }
    for (const column of table.columns) {
      if (LOOKS_PERSONAL.test(column.name)) found.add(`${table.name}.${column.name}`)
    }
  }
  return found
}

describe('personal data columns', () => {
  test('every column that looks like personal data is handled by the export and erasure, or left alone on purpose', () => {
    const known = new Set([...Object.keys(HANDLED), ...Object.keys(LEFT_ALONE)])
    const unknown = [...personalColumns()].filter((c) => !known.has(c))
    assert.deepEqual(
      unknown,
      [],
      `New columns that look like personal data: ${unknown.join(', ')}. Add them to the export and the erasure in ` +
        'modules/customers/src/privacy.ts and list them in HANDLED here, or list them in LEFT_ALONE with the reason.',
    )
  })

  test('nothing listed here is gone from the schema', () => {
    const found = personalColumns()
    const stale = [...Object.keys(HANDLED), ...Object.keys(LEFT_ALONE)].filter((c) => !found.has(c))
    assert.deepEqual(stale, [], `Listed but no longer in the schema (remove them): ${stale.join(', ')}`)
  })

  test('a column is not both handled and left alone', () => {
    assert.deepEqual(
      Object.keys(HANDLED).filter((c) => c in LEFT_ALONE),
      [],
    )
  })
})

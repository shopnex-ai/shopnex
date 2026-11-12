// Custom field definitions and values on a real in-memory database (PGlite), the way the app runs them.
import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'

// Set before the modules load: @shopnex/db picks its database when it is first imported
process.env.DATABASE_URL = 'pglite:memory'

const { db, schema, prepareDatabase } = await import('@shopnex/db')
const { CustomFieldError, customFieldService: fields } = await import('../src')
const { eq } = await import('drizzle-orm')

const SHOP = 'default'

before(async () => {
  await prepareDatabase()
})

after(() => {
  // The embedded database keeps the process alive
  setImmediate(() => process.exit())
})

/** Asserts the promise fails with a CustomFieldError of this code */
function rejectsWith(code: 'KEY_TAKEN' | 'INVALID_VALUE', work: Promise<unknown> | (() => unknown), message?: RegExp) {
  return assert.rejects(Promise.resolve().then(typeof work === 'function' ? work : () => work), (error: unknown) => {
    assert.ok(error instanceof CustomFieldError, String(error))
    assert.equal(error.code, code)
    if (message) assert.match(error.message, message)
    return true
  })
}

describe('create and list', () => {
  test('creates a field at the end of its resource, one position after the last', async () => {
    const a = await fields.create(SHOP, { resource: 'product', key: 'pos_a', label: 'A', type: 'text' }, db)
    const b = await fields.create(SHOP, { resource: 'product', key: 'pos_b', label: 'B', type: 'text' }, db)
    const other = await fields.create(SHOP, { resource: 'order', key: 'pos_a', label: 'A', type: 'text' }, db)
    assert.equal(b.position, a.position + 1)
    assert.equal(other.position, 0, 'positions count per resource')
    assert.equal(a.storefront, false)
  })

  test('refuses a second field with the same key on the same resource', async () => {
    await fields.create(SHOP, { resource: 'customer', key: 'taken', label: 'T', type: 'text' }, db)
    await rejectsWith(
      'KEY_TAKEN',
      fields.create(SHOP, { resource: 'customer', key: 'taken', label: 'Again', type: 'number' }, db),
      /customer field with the key "taken" already exists/,
    )
  })

  test('a choice field keeps its options trimmed and without duplicates or blanks', async () => {
    const f = await fields.create(
      SHOP,
      { resource: 'product', key: 'size', label: 'Size', type: 'choice', options: [' S ', 'M', 'S', '', 'L'] },
      db,
    )
    assert.deepEqual(f.options, ['S', 'M', 'L'])
  })

  test('only a choice field has options, and a choice field needs some', async () => {
    await rejectsWith(
      'INVALID_VALUE',
      fields.create(SHOP, { resource: 'product', key: 'bad_text', label: 'x', type: 'text', options: ['a'] }, db),
      /Only a choice field has options/,
    )
    await rejectsWith(
      'INVALID_VALUE',
      fields.create(SHOP, { resource: 'product', key: 'bad_choice', label: 'x', type: 'choice' }, db),
      /needs at least one option/,
    )
  })

  test('allows up to 50 options of 100 characters', async () => {
    const fifty = Array.from({ length: 50 }, (_, i) => `option ${i}`)
    const ok = await fields.create(
      SHOP,
      { resource: 'order', key: 'fifty', label: 'x', type: 'choice', options: fifty },
      db,
    )
    assert.equal(ok.options.length, 50)
    await rejectsWith(
      'INVALID_VALUE',
      fields.create(
        SHOP,
        { resource: 'order', key: 'fifty_one', label: 'x', type: 'choice', options: [...fifty, 'one more'] },
        db,
      ),
      /Up to 50 options of 100 characters/,
    )
    await rejectsWith(
      'INVALID_VALUE',
      fields.create(
        SHOP,
        { resource: 'order', key: 'long_option', label: 'x', type: 'choice', options: ['x'.repeat(101)] },
        db,
      ),
      /Up to 50 options of 100 characters/,
    )
  })

  test('lists by resource, in order of position, or all of them', async () => {
    const products = await fields.list(SHOP, 'product', db)
    assert.ok(products.length >= 2 && products.every((f) => f.resource === 'product'))
    assert.deepEqual(
      products.map((f) => f.position),
      [...products.map((f) => f.position)].sort((x, y) => x - y),
    )
    const all = await fields.list(SHOP, undefined, db)
    assert.deepEqual([...new Set(all.map((f) => f.resource))], ['customer', 'order', 'product'], 'grouped by resource')
  })
})

describe('update', () => {
  test('changes the label, storefront flag and position', async () => {
    const f = await fields.create(SHOP, { resource: 'product', key: 'upd_basic', label: 'Old', type: 'text' }, db)
    const updated = await fields.update(SHOP, f.id, { label: 'New', storefront: true, position: 9 }, db)
    assert.equal(updated?.label, 'New')
    assert.equal(updated?.storefront, true)
    assert.equal(updated?.position, 9)
    assert.equal(updated?.key, 'upd_basic', 'the key is fixed')
  })

  test('is null for a field that does not exist', async () => {
    assert.equal(await fields.update(SHOP, '00000000-0000-4000-8000-000000000000', { label: 'x' }, db), null)
    assert.equal(
      await fields.update(SHOP, '00000000-0000-4000-8000-000000000000', { options: ['a'] }, db),
      null,
      'also when options are being changed',
    )
  })

  test('options can be added but not removed', async () => {
    const f = await fields.create(
      SHOP,
      { resource: 'product', key: 'upd_opts', label: 'x', type: 'choice', options: ['a', 'b'] },
      db,
    )
    const added = await fields.update(SHOP, f.id, { options: ['a', 'b', ' c ', 'c'] }, db)
    assert.deepEqual(added?.options, ['a', 'b', 'c'])
    await rejectsWith('INVALID_VALUE', fields.update(SHOP, f.id, { options: ['a', 'c'] }, db), /added but not removed/)
  })

  test('options on a field that is not a choice are refused', async () => {
    const f = await fields.create(SHOP, { resource: 'product', key: 'upd_text', label: 'x', type: 'text' }, db)
    await rejectsWith(
      'INVALID_VALUE',
      fields.update(SHOP, f.id, { options: ['a'] }, db),
      /Only a choice field has options/,
    )
  })
})

describe('remove', () => {
  test('deletes the definition and the values stored under its key, and nothing else', async () => {
    const f = await fields.create(SHOP, { resource: 'customer', key: 'rm_me', label: 'x', type: 'text' }, db)
    await fields.create(SHOP, { resource: 'customer', key: 'rm_keep', label: 'x', type: 'text' }, db)
    const [customer] = await db
      .insert(schema.customers)
      .values({ shopId: SHOP, email: 'remove@example.com', customFields: { rm_me: 'gone', rm_keep: 'stays' } })
      .returning()
    const removed = await fields.remove(SHOP, f.id, db)
    assert.equal(removed?.key, 'rm_me')
    assert.deepEqual(
      (await fields.list(SHOP, 'customer', db)).map((d) => d.key).filter((k) => k.startsWith('rm_')),
      ['rm_keep'],
    )
    const [after] = await db.select().from(schema.customers).where(eq(schema.customers.id, customer!.id))
    assert.deepEqual(after?.customFields, { rm_keep: 'stays' })
  })

  test('is null for a field that does not exist', async () => {
    assert.equal(await fields.remove(SHOP, '00000000-0000-4000-8000-000000000000', db), null)
  })

  test('rolls back as one: a failure while clearing the values keeps the definition', async () => {
    const f = await fields.create(SHOP, { resource: 'customer', key: 'rm_atomic', label: 'x', type: 'text' }, db)
    const bad = db.transaction(async (tx) => {
      await fields.remove(SHOP, f.id, tx)
      throw new Error('abort')
    })
    await assert.rejects(bad, /abort/)
    assert.ok((await fields.list(SHOP, 'customer', db)).some((d) => d.key === 'rm_atomic'))
  })
})

describe('merge', () => {
  before(async () => {
    await fields.create(SHOP, { resource: 'product', key: 'm_text', label: 'x', type: 'text' }, db)
    await fields.create(SHOP, { resource: 'product', key: 'm_number', label: 'x', type: 'number' }, db)
    await fields.create(SHOP, { resource: 'product', key: 'm_flag', label: 'x', type: 'boolean' }, db)
    await fields.create(
      SHOP,
      { resource: 'product', key: 'm_choice', label: 'x', type: 'choice', options: ['red', 'blue'] },
      db,
    )
    await fields.create(SHOP, { resource: 'product', key: 'm_file', label: 'x', type: 'file' }, db)
  })

  const merge = (updates: Record<string, string | number | boolean | null>, current = {}) =>
    fields.merge(SHOP, 'product', updates, current, db)

  test('sets valid values of each type and keeps the keys that were left out', async () => {
    const next = await merge(
      { m_text: 'hi', m_number: 4.5, m_flag: false, m_choice: 'red', m_file: 'https://cdn.example.com/a.png' },
      { other: 'kept' },
    )
    assert.deepEqual(next, {
      other: 'kept',
      m_text: 'hi',
      m_number: 4.5,
      m_flag: false,
      m_choice: 'red',
      m_file: 'https://cdn.example.com/a.png',
    })
  })

  test('null clears a field and does not touch the object it was given', async () => {
    const current = { m_text: 'bye', m_flag: true }
    const next = await merge({ m_text: null }, current)
    assert.deepEqual(next, { m_flag: true })
    assert.deepEqual(current, { m_text: 'bye', m_flag: true })
  })

  test('with no updates returns the current values untouched', async () => {
    const current = { m_text: 'same' }
    assert.equal(await merge({}, current), current)
  })

  test('rejects a key that has no definition', async () => {
    await rejectsWith('INVALID_VALUE', merge({ nope: 'x' }), /There is no product custom field "nope"/)
  })

  test('rejects a value of the wrong type', async () => {
    await rejectsWith('INVALID_VALUE', merge({ m_text: 5 }), /"m_text" \(text\): expected text/)
    await rejectsWith('INVALID_VALUE', merge({ m_number: 'x' }), /expected a number/)
    await rejectsWith('INVALID_VALUE', merge({ m_number: Number.POSITIVE_INFINITY }), /expected a number/)
    await rejectsWith('INVALID_VALUE', merge({ m_flag: 'yes' }), /expected true or false/)
  })

  test('text is limited to 1000 characters', async () => {
    assert.equal((await merge({ m_text: 'x'.repeat(1000) })).m_text?.toString().length, 1000)
    await rejectsWith('INVALID_VALUE', merge({ m_text: 'x'.repeat(1001) }), /at most 1000 characters/)
  })

  test('a choice must be one of its options', async () => {
    await rejectsWith('INVALID_VALUE', merge({ m_choice: 'green' }), /expected one of: red, blue/)
    await rejectsWith('INVALID_VALUE', merge({ m_choice: 3 }), /expected one of: red, blue/)
  })

  test('a file must be an absolute http(s) URL of at most 2000 characters', async () => {
    for (const value of [
      'not a url',
      'ftp://example.com/a',
      'javascript:alert(1)',
      7,
      `https://example.com/${'a'.repeat(2000)}`,
    ]) {
      await rejectsWith(
        'INVALID_VALUE',
        merge({ m_file: value }),
        /expected (an absolute http\(s\) URL|the URL of an uploaded file)/,
      )
    }
    assert.equal(
      (await merge({ m_file: 'http://localhost:3000/files/a.png' })).m_file,
      'http://localhost:3000/files/a.png',
    )
  })

  test('does not leak into another resource', async () => {
    await rejectsWith(
      'INVALID_VALUE',
      fields.merge(SHOP, 'order', { m_text: 'x' }, {}, db),
      /no order custom field "m_text"/,
    )
  })
})

describe('storefrontView', () => {
  test('keeps only the values of fields shown on the storefront', async () => {
    await fields.create(SHOP, { resource: 'order', key: 'sv_public', label: 'x', type: 'text', storefront: true }, db)
    await fields.create(SHOP, { resource: 'order', key: 'sv_private', label: 'x', type: 'text' }, db)
    const view = await fields.storefrontView(SHOP, 'order', db)
    assert.deepEqual(view({ sv_public: 'shown', sv_private: 'hidden', unknown: 'x' }), { sv_public: 'shown' })
    assert.deepEqual(view({ sv_private: 'hidden' }), {}, 'a field with no value is left out')
  })
})

describe('parseFilters', () => {
  before(async () => {
    await fields.create(SHOP, { resource: 'customer', key: 'f_public', label: 'x', type: 'text', storefront: true }, db)
    await fields.create(SHOP, { resource: 'customer', key: 'f_private', label: 'x', type: 'text' }, db)
  })

  test('turns key:value pairs into filters, and a value may contain a colon', async () => {
    assert.deepEqual(await fields.parseFilters(SHOP, 'customer', ['f_public:a', 'f_private:12:30'], {}, db), {
      f_public: 'a',
      f_private: '12:30',
    })
  })

  test('no pairs, no filters', async () => {
    assert.deepEqual(await fields.parseFilters(SHOP, 'customer', [], {}, db), {})
  })

  test('refuses a pair for a field that does not exist or has no key', async () => {
    await rejectsWith('INVALID_VALUE', fields.parseFilters(SHOP, 'customer', ['nope:1'], {}, db), /"nope:1"/)
    await rejectsWith('INVALID_VALUE', fields.parseFilters(SHOP, 'customer', [':1'], {}, db), /":1"/)
    await rejectsWith('INVALID_VALUE', fields.parseFilters(SHOP, 'customer', ['f_public'], {}, db), /"f_public"/)
  })

  test('on the storefront a private field matches nothing, so it cannot be probed', async () => {
    assert.deepEqual(await fields.parseFilters(SHOP, 'customer', ['f_public:a'], { storefrontOnly: true }, db), {
      f_public: 'a',
    })
    await rejectsWith(
      'INVALID_VALUE',
      fields.parseFilters(SHOP, 'customer', ['f_private:a'], { storefrontOnly: true }, db),
    )
  })
})

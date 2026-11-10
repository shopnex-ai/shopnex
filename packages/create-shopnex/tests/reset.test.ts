import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { UsageError } from '../src/errors'
import { resetData } from '../src/reset'

const temp = () => mkdtempSync(join(tmpdir(), 'create-shopnex-'))

test('a missing folder is nothing to delete', () => {
  assert.equal(resetData(join(temp(), 'nope'), { yes: true }), 'nothing to delete')
})

test('a folder that is not a PGlite database is never deleted, even with --yes', () => {
  const dir = temp()
  writeFileSync(join(dir, 'precious.txt'), 'keep')
  assert.throws(() => resetData(dir, { yes: true }), UsageError)
  assert.ok(existsSync(join(dir, 'precious.txt')))
})

test('a database folder needs --yes, then it is deleted', () => {
  const dir = temp()
  mkdirSync(join(dir, 'base'))
  writeFileSync(join(dir, 'PG_VERSION'), '18')
  assert.throws(() => resetData(dir, { yes: false }), /--yes/)
  assert.ok(existsSync(dir))
  assert.match(resetData(dir, { yes: true }), /deleted/)
  assert.ok(!existsSync(dir))
})

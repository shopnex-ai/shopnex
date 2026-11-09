// The Architecture page lists the modules from their package.json `description`, so each one needs one.
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

const modules = join(import.meta.dirname, '../..')

test('every module has a description in its package.json', () => {
  const missing = readdirSync(modules).filter((dir) => {
    const pkg = JSON.parse(readFileSync(join(modules, dir, 'package.json'), 'utf8')) as { description?: string }
    return !pkg.description?.trim()
  })
  assert.deepEqual(missing, [], `Add a "description" to modules/<name>/package.json: ${missing.join(', ')}`)
})

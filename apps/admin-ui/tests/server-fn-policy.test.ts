import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, test } from 'node:test'

const src = join(import.meta.dirname, '../src')
const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? walk(path) : /\.tsx?$/.test(name) ? [path] : []
  })

// A server function is its own public HTTP endpoint, so a check in the page loader does not protect it.
// lib/server-fn.ts has the only two doors: adminFn (session and role checked before the handler) and publicFn.
describe('server functions', () => {
  test('are only made with adminFn or publicFn', () => {
    const offenders = walk(src)
      .filter((file) => !file.endsWith('routeTree.gen.ts') && !file.endsWith('lib/server-fn.ts'))
      .filter((file) => /\bcreateServerFn\b/.test(readFileSync(file, 'utf8')))
      .map((file) => relative(src, file))
    assert.deepEqual(offenders, [], 'use adminFn (or publicFn, with a comment saying why) from @/lib/server-fn')
  })

  test('adminFn handlers do not take a shop, user or URL from their input', () => {
    const offenders = walk(src)
      .filter((file) => /\badmin(Post)?Fn\b/.test(readFileSync(file, 'utf8')) && !file.endsWith('lib/server-fn.ts'))
      .filter((file) => /\.validator\([^)]*\b(shopId|userId|\w*Url)\b/.test(readFileSync(file, 'utf8')))
      .map((file) => relative(src, file))
    assert.deepEqual(offenders, [], 'take shop and user from the handler context')
  })
})

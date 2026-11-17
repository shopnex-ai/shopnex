// The guard the destructive tests call: only the embedded database passes, and a real one is refused before any row is touched.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { describe, test } from 'node:test'
import { isEmbeddedUrl } from '../src'

const probe = (databaseUrl: string) => {
  try {
    execFileSync(
      process.execPath,
      [
        '--import',
        'tsx',
        '-e',
        "import('./src/index.ts').then((m) => { m.requireEmbeddedDatabase(); console.log('allowed') })",
      ],
      {
        cwd: new URL('..', import.meta.url),
        env: { ...process.env, DATABASE_URL: databaseUrl },
        encoding: 'utf8',
        stdio: 'pipe',
      },
    )
    return { allowed: true, error: '' }
  } catch (error) {
    return { allowed: false, error: String((error as { stderr?: string }).stderr ?? error) }
  }
}

describe('requireEmbeddedDatabase', () => {
  test('knows which URLs are the embedded database', () => {
    assert.equal(isEmbeddedUrl('pglite:memory'), true)
    assert.equal(isEmbeddedUrl('pglite:/tmp/shop'), true)
    assert.equal(isEmbeddedUrl('postgres://user@localhost:5432/shopnex'), false)
    assert.equal(isEmbeddedUrl(''), false)
  })

  test('lets the embedded database through', () => {
    assert.equal(probe('pglite:memory').allowed, true)
  })

  test('refuses a real database, with the reason and without printing its address', () => {
    const result = probe('postgres://secret-user:secret-password@db.example.com:5432/shopnex')
    assert.equal(result.allowed, false)
    assert.match(result.error, /must run on the embedded database/)
    assert.ok(!result.error.includes('secret-password'))
  })
})

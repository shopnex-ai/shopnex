import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { composeUrl, writeScaffold } from '../src/scaffold'

const shop = () => join(mkdtempSync(join(tmpdir(), 'create-shopnex-scaffold-')), 'shop')
const answer = (body: string, status = 200) => (async () => new Response(body, { status })) as typeof fetch

test('a new shop gets a .gitignore and the fetched docker-compose.yml, and existing files are kept', async () => {
  const dir = shop()
  const urls: string[] = []
  const fetcher = (async (url: string) => (urls.push(url), new Response('services: {}\n'))) as unknown as typeof fetch
  assert.equal(await writeScaffold(dir, '1.2.3', fetcher), undefined)
  assert.deepEqual(urls, [composeUrl('1.2.3')])
  assert.match(readFileSync(join(dir, '.gitignore'), 'utf8'), /^\.pglite\/$/m)
  assert.match(readFileSync(join(dir, '.gitignore'), 'utf8'), /^\.env$/m)
  assert.equal(readFileSync(join(dir, 'docker-compose.yml'), 'utf8'), 'services: {}\n')
  writeFileSync(join(dir, '.gitignore'), 'mine\n')
  await writeScaffold(dir, '1.2.3', answer('other'))
  assert.equal(readFileSync(join(dir, '.gitignore'), 'utf8'), 'mine\n')
  assert.equal(readFileSync(join(dir, 'docker-compose.yml'), 'utf8'), 'services: {}\n')
})

test('the tag of the version is fetched, main for an edge build', () => {
  assert.match(composeUrl('1.2.3'), /\/shopnex\/v1\.2\.3\/deploy\/docker-compose\.yml$/)
  assert.match(composeUrl('1.2.3-edge.4'), /\/shopnex\/main\/deploy\/docker-compose\.yml$/)
})

test('a failed fetch is a warning, not an error, and the .gitignore is still written', async () => {
  const dir = shop()
  assert.match((await writeScaffold(dir, '1.2.3', answer('nope', 404))) ?? '', /answered 404/)
  const offline = (async () => {
    throw new Error('offline')
  }) as typeof fetch
  assert.match((await writeScaffold(dir, '1.2.3', offline)) ?? '', /offline/)
  assert.equal(existsSync(join(dir, 'docker-compose.yml')), false)
  assert.equal(existsSync(join(dir, '.gitignore')), true)
})

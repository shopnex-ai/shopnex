import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { UsageError } from '@shopnex/cli-core/errors'
import { appFiles, checkName, generateApp } from '../src/generate'

const cwd = () => mkdtempSync(join(tmpdir(), 'shopnex-generate-'))

test('a new app stands on its own: real versions, its own tsconfig, its name in the page', () => {
  const dir = cwd()
  const folder = generateApp({ name: 'my-app', dir: dir, version: '1.2.3' })
  assert.equal(folder, join(dir, 'my-app'))
  const pkg = JSON.parse(readFileSync(join(folder, 'package.json'), 'utf8'))
  assert.equal(pkg.name, 'my-app')
  assert.equal(pkg.dependencies['@shopnex/app'], '^1.2.3')
  assert.doesNotMatch(JSON.stringify(pkg), /workspace:|catalog:/)
  assert.doesNotMatch(readFileSync(join(folder, 'tsconfig.json'), 'utf8'), /extends/)
  assert.match(readFileSync(join(folder, 'src/server.tsx'), 'utf8'), /title="My app"/)
  for (const file of ['.env.example', '.gitignore', 'README.md']) assert.equal(existsSync(join(folder, file)), true)
})

test('inside a shop folder (it has the .env) the app goes to apps/<name>', () => {
  const dir = cwd()
  writeFileSync(join(dir, '.env'), 'DATABASE_URL=pglite:./.pglite\n')
  const folder = generateApp({ name: 'stripe', dir, version: '1.0.0' })
  assert.equal(folder, join(dir, 'apps', 'stripe'))
  assert.equal(existsSync(join(folder, 'src/server.tsx')), true)
})

test('the files are the same every time', () => {
  assert.deepEqual(appFiles('shop-tools', '1.0.0'), appFiles('shop-tools', '1.0.0'))
})

test('a name is required and must be a plain folder name', () => {
  assert.throws(() => checkName(undefined), UsageError)
  for (const bad of ['My App', '-x', '../up/Down']) assert.throws(() => checkName(bad), /usable app name/)
  checkName('team/ok-app')
})

test('an empty folder is used, a folder with files in it is not touched', () => {
  const dir = cwd()
  mkdirSync(join(dir, 'empty'))
  generateApp({ name: 'empty', dir: dir, version: '1.0.0' })
  mkdirSync(join(dir, 'taken'))
  writeFileSync(join(dir, 'taken', 'mine.txt'), 'mine')
  assert.throws(() => generateApp({ name: 'taken', dir: dir, version: '1.0.0' }), /not empty/)
  assert.equal(readFileSync(join(dir, 'taken', 'mine.txt'), 'utf8'), 'mine')
})

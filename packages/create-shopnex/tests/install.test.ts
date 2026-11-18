import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { hasShopPackage, packageManager, setupInstall, wantsInstall } from '../src/install'

const shop = (pkg: object | null = { dependencies: { 'create-shopnex': '1.2.3' } }) => {
  const dir = mkdtempSync(join(tmpdir(), 'create-shopnex-install-'))
  if (pkg) writeFileSync(join(dir, 'package.json'), JSON.stringify(pkg))
  return dir
}

/** A stand-in for child_process.spawn: records the call, and the test decides how the "install" ends */
const fake = () => {
  const calls: unknown[][] = []
  const child = Object.assign(new EventEmitter(), {
    stdout: new EventEmitter(),
    stderr: new EventEmitter(),
    killed: false,
    kill() {
      this.killed = true
    },
  })
  const spawn = ((...args: unknown[]) => (calls.push(args), child)) as never
  return { calls, child, spawn }
}

test('the package manager is the one that started create-shopnex, npm when unknown', () => {
  assert.equal(packageManager('pnpm/9.1.0 npm/? node/v22'), 'pnpm')
  assert.equal(packageManager('yarn/1.22.0 npm/?'), 'yarn')
  assert.equal(packageManager('bun/1.1.0'), 'bun')
  assert.equal(packageManager('npm/10.0.0 node/v22'), 'npm')
  assert.equal(packageManager(''), 'npm')
})

test('only a package.json that lists create-shopnex is ours, and an installed one is not installed again', () => {
  assert.equal(hasShopPackage(shop()), true)
  assert.equal(hasShopPackage(shop({ name: 'mine' })), false)
  assert.equal(hasShopPackage(shop(null)), false)
  assert.equal(wantsInstall(shop()), true)
  const installed = shop()
  mkdirSync(join(installed, 'node_modules', 'create-shopnex'), { recursive: true })
  assert.equal(wantsInstall(installed), false)
})

test('it installs in the shop folder with the same package manager, silently', () => {
  const dir = shop()
  const { calls, child, spawn } = fake()
  const lines: string[] = []
  const install = setupInstall(dir, { enabled: true, manager: 'pnpm', spawn, onLine: (line) => lines.push(line) })
  assert.deepEqual(calls[0]?.slice(0, 2), ['pnpm', ['install']])
  assert.equal((calls[0]?.[2] as { cwd: string }).cwd, dir)
  child.stdout.emit('data', Buffer.from('Progress: 1\nDone'))
  child.stdout.emit('data', Buffer.from('\n'))
  assert.deepEqual(lines, ['Progress: 1', 'Done'])
  assert.equal(install?.nextTime(), 'pnpm install, then pnpm start') // not finished yet
  child.emit('exit', 0)
  assert.equal(install?.nextTime(), 'pnpm start')
})

test('a failed install changes nothing but what is told afterwards', () => {
  const { child, spawn } = fake()
  const install = setupInstall(shop(), { enabled: true, manager: 'npm', spawn })
  child.emit('exit', 1)
  assert.equal(install?.nextTime(), 'npm install, then npm start')
  const missing = fake()
  const second = setupInstall(shop(), { enabled: true, manager: 'npm', spawn: missing.spawn })
  missing.child.emit('error', new Error('ENOENT'))
  assert.equal(second?.nextTime(), 'npm install, then npm start')
})

test('--no-install, an installed folder and a package.json of the user start nothing', () => {
  const off = fake()
  assert.equal(
    setupInstall(shop(), { enabled: false, manager: 'npm', spawn: off.spawn })?.nextTime(),
    'npm install, then npm start',
  )
  const installed = shop()
  mkdirSync(join(installed, 'node_modules', 'create-shopnex'), { recursive: true })
  assert.equal(setupInstall(installed, { enabled: true, manager: 'npm', spawn: off.spawn })?.nextTime(), 'npm start')
  assert.equal(setupInstall(shop({ name: 'mine' }), { enabled: true, spawn: off.spawn }), undefined)
  assert.equal(off.calls.length, 0)
})

test('stop ends a running install, and leaves a finished one alone', () => {
  const running = fake()
  setupInstall(shop(), { enabled: true, manager: 'npm', spawn: running.spawn })?.stop()
  assert.equal(running.child.killed, true)
  const done = fake()
  const install = setupInstall(shop(), { enabled: true, manager: 'npm', spawn: done.spawn })
  done.child.emit('exit', 0)
  install?.stop()
  assert.equal(done.child.killed, false)
})

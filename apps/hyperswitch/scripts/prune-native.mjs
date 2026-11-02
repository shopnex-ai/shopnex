#!/usr/bin/env node
// hyperswitch-prism ships its native library for every platform (~490 MB, 140-180 MB each) and koffi ships ~20 builds,
// but a machine loads one. Run after install (e.g. in the image build) to delete the others:
//
//   pnpm --filter @shopnex/hyperswitch prune-native
//
// Only for node_modules that will run on the machine/image that prunes them (not one copied to another architecture).
import { existsSync, readdirSync, realpathSync, rmSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

const require = createRequire(import.meta.url)
const { platform, arch } = process
let freed = 0

const size = (path) =>
  statSync(path).isDirectory()
    ? readdirSync(path).reduce((sum, name) => sum + size(join(path, name)), 0)
    : statSync(path).size

function prune(dir, keep) {
  if (!existsSync(dir)) return
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (!statSync(path).isDirectory() || keep(name)) continue
    freed += size(path)
    rmSync(path, { recursive: true, force: true })
  }
}

const packageDir = (name, from = require) => dirname(realpathSync(from.resolve(`${name}/package.json`)))
const prism = packageDir('hyperswitch-prism')

prune(join(prism, 'dist/src/payments/generated'), (name) => name === `${platform}-${arch}`)
// koffi names its builds <platform>_<arch> (musl_<arch> for Alpine); the libc isn't known here, so keep both on Linux
prune(
  join(packageDir('koffi', createRequire(join(prism, 'package.json'))), 'build/koffi'),
  (name) => name === `${platform}_${arch}` || (platform === 'linux' && name === `musl_${arch}`),
)
console.log(`Pruned ${(freed / 1e6).toFixed(0)} MB of native libraries for other platforms (kept ${platform}-${arch})`)

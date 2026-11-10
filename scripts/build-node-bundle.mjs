#!/usr/bin/env node
// Builds the packaged ShopNex that `npx create-shopnex` downloads and runs without a checkout:
//
//   pnpm build && pnpm --dir templates/storefront build
//   node scripts/build-node-bundle.mjs 0.14.0 [outDir]    → <outDir>/shopnex-v0.14.0-node.tgz (+ .sha256)
//
// Contents: admin/ (the admin, API and checkout server, bundled into a few files; the embedded database is the one
// package left as a real dependency, because it loads its WebAssembly from next to itself), storefront/ (the built
// Astro server and the themes), migrations/ and manifest.json. Plain JavaScript and WebAssembly, so one file for
// every OS and CPU. The file layout is what packages/create-shopnex/src/checkout.ts (planFromBundle) runs.
import { build } from 'esbuild'
import { createHash } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const version = process.argv[2]?.replace(/^v/, '')
if (!version) {
  console.error('Usage: node scripts/build-node-bundle.mjs <version> [outDir]')
  process.exit(1)
}
const outDir = resolve(process.argv[3] ?? join(tmpdir(), 'shopnex-bundle'))
const stage = join(outDir, 'stage')

for (const required of ['apps/admin-ui/dist/client', 'apps/admin-ui/dist/server', 'templates/storefront/dist/server']) {
  if (!existsSync(join(root, required))) {
    console.error(`${required} is missing. Build first: pnpm build && pnpm --dir templates/storefront build`)
    process.exit(1)
  }
}

rmSync(outDir, { recursive: true, force: true })
mkdirSync(stage, { recursive: true })

// Bundled CommonJS dependencies call require()
const banner = { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" }
const common = {
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  splitting: true,
  minify: true,
  legalComments: 'none',
  outExtension: { '.js': '.mjs' },
  banner,
  logLevel: 'warning',
}

// Admin: the production server (apps/admin-ui/server.mjs) with the TanStack Start build inlined. Static files are
// served from ./dist/client, so the server runs from this folder.
await build({
  ...common,
  entryPoints: [join(root, 'apps/admin-ui/server.mjs')],
  outdir: join(stage, 'admin'),
  external: ['@electric-sql/pglite', 'pg-native'],
})
cpSync(join(root, 'apps/admin-ui/dist/client'), join(stage, 'admin/dist/client'), { recursive: true })
// The package's root folder: its package.json is not an export, so walk up from the entry file
let pglite = dirname(createRequire(join(root, 'modules/db/package.json')).resolve('@electric-sql/pglite'))
while (
  !existsSync(join(pglite, 'package.json')) ||
  JSON.parse(readFileSync(join(pglite, 'package.json'), 'utf8')).name !== '@electric-sql/pglite'
) {
  pglite = dirname(pglite)
}
cpSync(pglite, join(stage, 'admin/node_modules/@electric-sql/pglite'), { recursive: true, dereference: true })

// Storefront: Astro's standalone server, inlined. It reads themes/ from the folder it runs in.
await build({
  ...common,
  entryPoints: [join(root, 'templates/storefront/dist/server/entry.mjs')],
  outdir: join(stage, 'storefront/dist/server'),
})
cpSync(join(root, 'templates/storefront/dist/client'), join(stage, 'storefront/dist/client'), { recursive: true })
cpSync(join(root, 'templates/storefront/themes'), join(stage, 'storefront/themes'), { recursive: true })

cpSync(join(root, 'modules/db/migrations'), join(stage, 'migrations'), { recursive: true })
writeFileSync(join(stage, 'manifest.json'), JSON.stringify({ version, builtAt: new Date().toISOString() }, null, 2))

const file = join(outDir, `shopnex-v${version}-node.tgz`)
const tar = spawnSync('tar', ['-czf', file, '-C', stage, '.'], { stdio: 'inherit' })
if (tar.status !== 0) process.exit(tar.status ?? 1)
const sha = createHash('sha256').update(readFileSync(file)).digest('hex')
writeFileSync(`${file}.sha256`, `${sha}  ${file.split('/').pop()}\n`)
rmSync(stage, { recursive: true, force: true })
console.log(`${file}\n${sha}`)

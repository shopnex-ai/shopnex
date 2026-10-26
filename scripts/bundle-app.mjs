#!/usr/bin/env node
// Bundles a bundled app (apps/<name> on @shopnex/app) into one file for its container image:
//
//   node scripts/bundle-app.mjs apps/stripe        → apps/stripe/dist/server.mjs
//
// Everything is inlined (no node_modules at runtime). @shopnex/app reads the app-bridge file from disk, which a
// bundle can't do, so that one read is replaced by the file's contents.
import { build } from 'esbuild'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const dir = resolve(process.argv[2] ?? '')
const entry = ['src/server.tsx', 'src/server.ts'].map((f) => join(dir, f)).find(existsSync)
if (!entry) {
  console.error('Usage: node scripts/bundle-app.mjs apps/<name>  (needs src/server.tsx or src/server.ts)')
  process.exit(1)
}

const bridgeRead = "readFileSync(fileURLToPath(import.meta.resolve('@shopnex/app-bridge')), 'utf8')"
const inlineAppBridge = {
  name: 'inline-app-bridge',
  setup(b) {
    b.onLoad({ filter: /packages[\\/]app[\\/]src[\\/]index\.ts$/ }, (args) => {
      const source = readFileSync(args.path, 'utf8')
      if (!source.includes(bridgeRead)) throw new Error(`inline-app-bridge: ${bridgeRead} not found in ${args.path}`)
      const bridge = readFileSync(join(root, 'packages/app-bridge/src/index.js'), 'utf8')
      return { contents: source.replace(bridgeRead, JSON.stringify(bridge)), loader: 'ts' }
    })
  },
}

await build({
  entryPoints: [entry],
  outfile: join(dir, 'dist/server.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  minify: true,
  legalComments: 'none',
  // Bundled CommonJS dependencies call require()
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  plugins: [inlineAppBridge],
  logLevel: 'info',
})

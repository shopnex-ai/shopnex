#!/usr/bin/env node
// Bundles a bundled app (apps/<name> on @shopnex/app) into one file for its container image:
//
//   node scripts/bundle-app.mjs apps/stripe        → apps/stripe/dist/server.mjs
//
// Everything is inlined (no node_modules at runtime), except the embedded database (PGlite ships its WebAssembly as
// files, and is only used when no Postgres URL is set; its Drizzle driver would import it at startup) and an app's drizzle/ migrations folder, which is copied next to the
// bundle. @shopnex/app reads the app-bridge file from disk, which a bundle can't do, so that read is replaced by the
// file's contents; its own browser script (client.ts) is compiled here and the compiled text put in the same way, and so
// is its stylesheet (ui.css). The same goes for an app's own icon:
// `readFileSync(new URL('./icon.svg', import.meta.url), 'utf8')` becomes the SVG's text (a `.js` file the app serves,
// like the reviews widget, or a `.css` file it writes into its pages, the same way).
import { build, transformSync } from 'esbuild'
import { cpSync, existsSync, readFileSync, rmSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const dir = resolve(process.argv[2] ?? '')
const entry = ['src/server.tsx', 'src/server.ts'].map((f) => join(dir, f)).find(existsSync)
if (!entry) {
  console.error('Usage: node scripts/bundle-app.mjs apps/<name>  (needs src/server.tsx or src/server.ts)')
  process.exit(1)
}

// What @shopnex/app reads from disk for the browser: per source file, the exact expression that reads it (in
// packages/app/src) and the text to put there
const minifyCss = (css) => transformSync(css, { loader: 'css', minify: true }).code
const browserFiles = {
  'index.ts': [
    {
      read: "readFileSync(fileURLToPath(import.meta.resolve('@shopnex/app-bridge')), 'utf8')",
      text: () => readFileSync(join(root, 'packages/app-bridge/src/index.js'), 'utf8'),
    },
    {
      read: "toBrowserJs(readFileSync(new URL('./client.ts', import.meta.url), 'utf8'))",
      text: () =>
        transformSync(readFileSync(join(root, 'packages/app/src/client.ts'), 'utf8'), {
          loader: 'ts',
          target: 'es2022',
          minify: true,
        }).code,
    },
  ],
  'ui.tsx': [
    {
      read: "readFileSync(new URL('./ui.css', import.meta.url), 'utf8')",
      text: () => minifyCss(readFileSync(join(root, 'packages/app/src/ui.css'), 'utf8')),
    },
  ],
}
const inlineBrowserFiles = {
  name: 'inline-browser-files',
  setup(b) {
    b.onLoad({ filter: /packages[\\/]app[\\/]src[\\/](index\.ts|ui\.tsx)$/ }, (args) => {
      let source = readFileSync(args.path, 'utf8')
      for (const { read, text } of browserFiles[basename(args.path)]) {
        if (!source.includes(read)) throw new Error(`inline-browser-files: ${read} not found in ${args.path}`)
        source = source.replace(read, () => JSON.stringify(text()))
      }
      return { contents: source, loader: args.path.endsWith('x') ? 'tsx' : 'ts' }
    })
  },
}

const svgRead = /readFileSync\(new URL\('(\.\/[\w.-]+\.(?:svg|js|css))', import\.meta\.url\), 'utf8'\)/g
const inlineSvgFiles = {
  name: 'inline-svg-files',
  setup(b) {
    b.onLoad({ filter: /\.tsx?$/ }, (args) => {
      if (!args.path.startsWith(join(dir, 'src'))) return
      const source = readFileSync(args.path, 'utf8')
      if (!svgRead.test(source)) return
      svgRead.lastIndex = 0
      const contents = source.replace(svgRead, (_, file) => {
        const text = readFileSync(join(dirname(args.path), file), 'utf8')
        return JSON.stringify(file.endsWith('.css') ? minifyCss(text) : text)
      })
      return { contents, loader: args.path.endsWith('x') ? 'tsx' : 'ts' }
    })
  },
}

await build({
  entryPoints: [entry],
  outfile: join(dir, 'dist/server.mjs'),
  bundle: true,
  // PGlite and Drizzle's driver for it stay out: they are only loaded when no Postgres URL is set
  external: ['@electric-sql/pglite', 'drizzle-orm/pglite', 'drizzle-orm/pglite/migrator', 'pg-native'],
  platform: 'node',
  format: 'esm',
  target: 'node22',
  minify: true,
  legalComments: 'none',
  // Bundled CommonJS dependencies call require()
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  plugins: [inlineBrowserFiles, inlineSvgFiles],
  logLevel: 'info',
})

// Migrations are read from disk: ship them with the bundle
rmSync(join(dir, 'dist/drizzle'), { recursive: true, force: true })
if (existsSync(join(dir, 'drizzle'))) cpSync(join(dir, 'drizzle'), join(dir, 'dist/drizzle'), { recursive: true })

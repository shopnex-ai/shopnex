// Bundles src/main.ts into dist/main.mjs: one file, no dependencies. Node does not strip types from files under
// node_modules, which is where `npx` puts a published package, so the package ships JavaScript.
import { build } from 'esbuild'
import { readFileSync } from 'node:fs'

const { version, engines } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))

await build({
  entryPoints: [new URL('../src/main.ts', import.meta.url).pathname],
  outfile: new URL('../dist/main.mjs', import.meta.url).pathname,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  // The bundle carries what it needs from package.json (the version it prints, the Node it requires)
  define: { __PKG__: JSON.stringify({ version, engines }) },
})
console.log(`create-shopnex ${version} built: dist/main.mjs`)

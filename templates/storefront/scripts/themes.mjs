#!/usr/bin/env node
// Builds what browsers load from themes and the storefront:
//
//   themes/{id}/src/theme.css → themes/{id}/assets/theme.css   Tailwind (scans the theme's folder)
//   themes/{id}/src/theme.ts  → themes/{id}/assets/theme.js    esbuild: TypeScript, npm packages, React islands
//   src/runtime/preview.ts    → public/shopnex/preview.js      the theme editor's preview connector
//
// A theme without src/theme.css or src/theme.ts skips that step. The server never runs theme code: these are
// only the files a theme's pages link to.
//
//   node scripts/themes.mjs           build once, minified (pnpm build)
//   node scripts/themes.mjs --watch   rebuild on change (pnpm dev)
import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as esbuild from 'esbuild'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const themesDir = process.env.SHOPNEX_THEMES_DIR ?? join(root, 'themes')

/** Builds everything; with `watch`, keeps rebuilding and returns a function that stops */
export async function buildThemes({ watch = false } = {}) {
  const { themes } = JSON.parse(readFileSync(join(themesDir, 'index.json'), 'utf8'))
  const scripts = [
    { name: 'preview', entry: join(root, 'src/runtime/preview.ts'), out: join(root, 'public/shopnex/preview.js') },
  ]
  const styles = []
  for (const id of themes) {
    const dir = join(themesDir, id)
    if (existsSync(join(dir, 'src/theme.ts')))
      scripts.push({ name: id, entry: join(dir, 'src/theme.ts'), out: join(dir, 'assets/theme.js') })
    if (existsSync(join(dir, 'src/theme.css')))
      styles.push({ name: id, entry: join(dir, 'src/theme.css'), out: join(dir, 'assets/theme.css') })
  }

  const options = (s) => ({
    entryPoints: [s.entry],
    outfile: s.out,
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    jsx: 'automatic',
    minify: !watch,
    sourcemap: watch ? 'inline' : false,
    define: { 'process.env.NODE_ENV': JSON.stringify(watch ? 'development' : 'production') },
    logLevel: 'warning',
  })

  if (!watch) {
    await Promise.all([
      ...scripts.map((s) => esbuild.build(options(s))),
      ...styles.map((s) => tailwind(s, ['--minify'])),
    ])
    console.log(`[themes] built ${themes.join(', ')}`)
    return async () => {}
  }

  const contexts = await Promise.all(scripts.map((s) => esbuild.context(options(s))))
  await Promise.all(contexts.map((c) => c.watch()))
  // --watch=always: keep watching with stdin closed (we're a child of pnpm dev)
  const children = styles.map((s) => tailwind(s, ['--watch=always'], true))
  console.log(`[themes] watching ${themes.join(', ')}`)
  return async () => {
    for (const child of children) child.kill()
    await Promise.all(contexts.map((c) => c.dispose()))
  }
}

/** Runs the Tailwind CLI for one stylesheet: resolves when built, or (watching) returns the process */
function tailwind(style, args, keepRunning = false) {
  const bin = join(root, 'node_modules/.bin/tailwindcss')
  const child = spawn(bin, ['-i', style.entry, '-o', style.out, ...args], {
    cwd: root,
    stdio: ['ignore', 'ignore', 'pipe'],
  })
  child.stderr.on('data', (data) => {
    const text = data.toString().trim()
    // The CLI reports each build on stderr ("Done in 120ms"); only errors are worth showing
    if (text && !/^(≈ tailwindcss|Done in)/m.test(text)) console.error(`[themes:${style.name}] ${text}`)
  })
  if (keepRunning) return child
  return new Promise((resolve, reject) =>
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`Tailwind failed for ${style.name}`)))),
  )
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const watch = process.argv.includes('--watch')
  buildThemes({ watch }).catch((error) => {
    console.error(error)
    process.exit(1)
  })
}

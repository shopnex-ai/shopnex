// Compiles the TypeScript samples in the docs against the real packages, so a renamed method or a wrong
// argument fails typecheck instead of misleading a developer. Each ```ts / ```tsx fence is written to
// .samples/ and checked with tsc.
//
// Samples are fragments, so a fence can name what it assumes is in scope: ```ts setup=app compiles it after
// samples/setups/app.ts (declarations only). ```ts nocheck skips a sample; every skip is listed in the output.
import { execFileSync } from 'node:child_process'
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join, relative } from 'node:path'

const CONTENT = 'content/docs'
const OUT = '.samples'

async function mdxFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true })
  const nested = await Promise.all(
    entries.map((e) => (e.isDirectory() ? mdxFiles(join(dir, e.name)) : [join(dir, e.name)])),
  )
  return nested.flat().filter((f) => f.endsWith('.mdx'))
}

await rm(OUT, { recursive: true, force: true })
await mkdir(OUT, { recursive: true })

let checked = 0
const skipped: string[] = []
for (const file of (await mdxFiles(CONTENT)).sort()) {
  const page = relative(CONTENT, file).replace(/\.mdx$/, '')
  const source = await readFile(file, 'utf8')
  let n = 0
  for (const m of source.matchAll(/^```(tsx?|typescript)([^\n]*)\n([\s\S]*?)^```/gm)) {
    n++
    const [, lang, meta = '', code = ''] = m
    const name = `${page.replaceAll('/', '__')}-${n}`
    if (/\bnocheck\b/.test(meta)) {
      skipped.push(`${page} (sample ${n})`)
      continue
    }
    const setup = meta.match(/\bsetup=([\w-]+)/)?.[1]
    const prelude = setup ? await readFile(join('samples/setups', `${setup}.ts`), 'utf8') : ''
    await writeFile(join(OUT, `${name}.${lang === 'tsx' ? 'tsx' : 'ts'}`), `${prelude}\n${code}\nexport {}\n`)
    checked++
  }
}

console.log(`Checking ${checked} samples${skipped.length ? `, skipping ${skipped.length}: ${skipped.join(', ')}` : ''}`)
try {
  execFileSync('pnpm', ['exec', 'tsc', '-p', 'samples/tsconfig.json'], { stdio: 'inherit' })
} catch {
  console.error('\nA sample in the docs does not compile (files are named <page>-<n> under apps/docs/.samples).')
  process.exit(1)
}

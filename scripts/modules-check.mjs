#!/usr/bin/env node
// `pnpm modules:check` reads modules/* and checks the module graph.
//
// Errors (exit 1):
//   - a module imports a module its package.json doesn't list, or lists one it never imports;
//   - a cycle between modules;
//   - a module without a manifest (`src/<name>.module.ts`), except the few that are tooling (NO_MANIFEST below), or a manifest whose `name` or
//     `dependsOn` differs from the folder and package.json;
//   - a table defined anywhere but a module's `src/*.schema.ts` (it would get no migration and escape the privacy test);
//   - a foreign key that points against the dependency graph (a table that references a module's table without depending on that module);
//   - the graph in docs/architecture.md differing from the manifests (`node scripts/modules-check.mjs --write` rewrites it).
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const root = fileURLToPath(new URL('..', import.meta.url))
const modulesDir = join(root, 'modules')

// Tooling every module may use without it being part of the module graph (not compared with a manifest's dependsOn)
const INFRA = new Set(['kit', 'log'])
// Modules that are tooling, not part of the product: they have no manifest (the connection, the module kit, the logger, the route
// building blocks, and the API that mounts every other module)
const NO_MANIFEST = new Set(['api', 'db', 'kit', 'log', 'rpc'])

const read = (file) => readFileSync(file, 'utf8')
const walk = (dir) =>
  !existsSync(dir)
    ? []
    : readdirSync(dir).flatMap((name) => {
        const path = join(dir, name)
        if (name === 'node_modules') return []
        return statSync(path).isDirectory() ? walk(path) : /\.(ts|tsx)$/.test(name) ? [path] : []
      })
const short = (name) => name.replace(/^@shopnex\//, '')

// ── the modules
const mods = new Map()
for (const entry of readdirSync(modulesDir, { withFileTypes: true })) {
  if (!entry.isDirectory() || !existsSync(join(modulesDir, entry.name, 'package.json'))) continue
  const dir = join(modulesDir, entry.name)
  const pkg = JSON.parse(read(join(dir, 'package.json')))
  const src = join(dir, 'src')
  const files = walk(src)
  const sources = new Map(files.map((file) => [file, read(file)]))
  const text = [...sources.values()].join('\n')
  const imported = new Set(
    [...text.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)'@shopnex\/([a-z-]+)/g)]
      .map((m) => m[1])
      .filter((n) => n !== entry.name),
  )
  const declared = new Set(
    Object.keys(pkg.dependencies ?? {})
      .filter((n) => n.startsWith('@shopnex/'))
      .map(short),
  )
  const manifestFile = existsSync(src) ? readdirSync(src).find((f) => f.endsWith('.module.ts')) : undefined
  mods.set(entry.name, { dir, pkgName: pkg.name, text, imported, declared, manifestFile, files, sources })
}

const errors = []

// ── imports against package.json, and the package name against the folder
for (const [name, m] of mods) {
  if (short(m.pkgName) !== name) errors.push(`${name}: the package is called ${m.pkgName}, the folder ${name}`)
  for (const dep of m.imported)
    if (!m.declared.has(dep)) errors.push(`${name}: imports @shopnex/${dep} but package.json does not list it`)
  for (const dep of m.declared)
    if (mods.has(dep) && !m.imported.has(dep) && !INFRA.has(dep) && m.files.length)
      errors.push(`${name}: lists @shopnex/${dep} but src never imports it`)
  if (!m.manifestFile && !NO_MANIFEST.has(name)) errors.push(`${name}: has no manifest (src/${name}.module.ts)`)
}

// ── core is the bottom of the graph: the tables every module points at. It may use the module kit and nothing else of ours, in code or
// in package.json.
const core = mods.get('core')
if (core) {
  for (const dep of [...core.imported, ...core.declared])
    if (mods.has(dep) && dep !== 'kit') errors.push(`core: depends on @shopnex/${dep}, but core may only depend on kit`)
}

// ── the manifests, read as code (the TypeScript parser), not matched as text: a comment, a line break or a trailing comma
// cannot make it pass or fail wrongly, and a manifest that is not a literal `defineModule({ name: '…', dependsOn: ['…'] })`
// is reported instead of guessed at
function readManifest(file) {
  const source = ts.createSourceFile(file, read(file), ts.ScriptTarget.Latest, true)
  let found
  const visit = (node) => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'defineModule') {
      found = node.arguments[0]
    }
    if (!found) ts.forEachChild(node, visit)
  }
  visit(source)
  if (!found || !ts.isObjectLiteralExpression(found))
    return { problem: 'has no defineModule({ ... }) with an object literal' }
  const property = (key) =>
    found.properties.find((p) => ts.isPropertyAssignment(p) && ts.isIdentifier(p.name) && p.name.text === key)
      ?.initializer
  const name = property('name')
  const depends = property('dependsOn')
  if (!name || !ts.isStringLiteralLike(name)) return { problem: 'has no string literal `name`' }
  if (!depends || !ts.isArrayLiteralExpression(depends) || !depends.elements.every((e) => ts.isStringLiteralLike(e))) {
    return { problem: 'has no `dependsOn` that is an array of string literals' }
  }
  return { name: name.text, dependsOn: new Set(depends.elements.map((e) => e.text)) }
}

for (const [name, m] of mods) {
  if (!m.manifestFile) continue
  const manifest = readManifest(join(m.dir, 'src', m.manifestFile))
  if (manifest.problem) {
    errors.push(`${name}: ${m.manifestFile} ${manifest.problem}`)
    continue
  }
  if (manifest.name !== name) errors.push(`${name}: ${m.manifestFile} says name ${manifest.name}`)
  const actual = new Set([...m.declared].filter((d) => !INFRA.has(d)))
  for (const d of manifest.dependsOn)
    if (!actual.has(d)) errors.push(`${name}: dependsOn lists ${d}, package.json does not`)
  for (const d of actual)
    if (!manifest.dependsOn.has(d)) errors.push(`${name}: package.json lists ${d}, dependsOn does not`)
}

// ── tables must be where drizzle-kit and the privacy test look for them: a module's own src/*.schema.ts. A table in any other file would
// get no migration (so the migration check, finding no change, would pass) and would be missing from the privacy check.
for (const [name, m] of mods) {
  for (const [file, source] of m.sources) {
    const where = relative(root, file)
    const allowed = /^modules\/[^/]+\/src\/[^/]+\.schema\.ts$/.test(where)
    if (!allowed && /\bpgTable\(/.test(source))
      errors.push(`${name}: ${where} defines a table but is not a *.schema.ts file, so it would get no migration`)
  }
}

// ── cycles, and the transitive closure used below
const graph = new Map([...mods].map(([name, m]) => [name, [...m.declared].filter((d) => mods.has(d))]))
const state = new Map()
const visit = (name, path) => {
  state.set(name, 1)
  for (const next of graph.get(name) ?? []) {
    if (state.get(next) === 1) {
      const loop = [...path, name]
      errors.push(`cycle: ${[...loop.slice(loop.indexOf(next)), next].join(' → ')}`)
      continue
    }
    if (!state.has(next)) visit(next, [...path, name])
  }
  state.set(name, 2)
}
for (const name of graph.keys()) if (!state.has(name)) visit(name, [])
const reach = (from, seen = new Set()) => {
  for (const next of graph.get(from) ?? []) if (!seen.has(next)) reach(next, seen.add(next))
  return seen
}

// ── which module owns each table: the *.schema.ts files modules own
const tableOwner = new Map()
const tableChunks = []
for (const [name, m] of mods)
  for (const f of m.files.filter((f) => f.endsWith('.schema.ts'))) {
    const parts = read(f).split(/^export const (\w+)\s*=\s*pgTable\(/m)
    for (let i = 1; i < parts.length; i += 2) {
      tableOwner.set(parts[i], name)
      tableChunks.push({ table: parts[i], owner: name, body: parts[i + 1] })
    }
  }

// ── foreign keys that point against the graph
const edges = new Map()
for (const { table, owner, body } of tableChunks) {
  for (const ref of body.matchAll(/references\(\(\)\s*=>\s*(\w+)\./g)) {
    const to = tableOwner.get(ref[1])
    if (!owner || !to || owner === to) continue
    const key = `${owner} → ${to}`
    edges.set(key, [...(edges.get(key) ?? []), `${table} → ${ref[1]}`])
  }
}
const against = [...edges].filter(([key]) => {
  const [from, to] = key.split(' → ')
  return mods.has(from) && mods.has(to) && !reach(from).has(to) && from !== to
})
for (const [key, fks] of against) errors.push(`foreign key against the graph: ${key} (${fks.join('; ')})`)

// ── the graph in the docs is generated from the manifests, so it cannot drift: between the two markers, one line per module
const GRAPH_START = '<!-- modules:graph:start -->'
const GRAPH_END = '<!-- modules:graph:end -->'
const docFile = join(root, 'docs', 'architecture.md')
const graphLines = [...mods]
  .sort(([a], [b]) => a.localeCompare(b))
  .map(
    ([name, m]) =>
      `${name} → ${
        [...m.declared]
          .filter((d) => mods.has(d) && !INFRA.has(d))
          .sort()
          .join(', ') || '(nothing)'
      }`,
  )
  .join('\n')
const docText = read(docFile)
const startAt = docText.indexOf(GRAPH_START)
const endAt = docText.indexOf(GRAPH_END)
if (startAt === -1 || endAt === -1) {
  errors.push(`docs/architecture.md: no ${GRAPH_START} … ${GRAPH_END} block for the module graph`)
} else {
  const current = docText.slice(startAt + GRAPH_START.length, endAt).trim()
  if (process.argv.includes('--write')) {
    writeFileSync(docFile, `${docText.slice(0, startAt + GRAPH_START.length)}\n${graphLines}\n${docText.slice(endAt)}`)
  } else if (current !== graphLines) {
    errors.push('docs/architecture.md: the module graph is out of date; run `node scripts/modules-check.mjs --write`')
  }
}

// ── output
const list = (items, indent = '  ') => items.map((i) => `${indent}${i}`).join('\n')
console.log(`${mods.size} modules, ${[...mods.values()].filter((m) => m.manifestFile).length} with a manifest.`)
if (errors.length) {
  console.error(`\nErrors (${errors.length}):\n${list(errors)}`)
  process.exit(1)
}
console.log('\nThe module graph is consistent.')

#!/usr/bin/env node
// `pnpm modules:check` reads modules/* and checks the module graph.
//
// Errors (exit 1): a module imports a module its package.json doesn't list; a cycle between modules; a manifest
// (`src/<name>.module.ts`) whose `name` or `dependsOn` differs from the folder and package.json.
// Reported only (what moving tables into modules will have to solve): tables a module reaches into that belong to
// another module, and foreign keys that point against the dependency graph. `--report` prints the lists in full.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const root = fileURLToPath(new URL('..', import.meta.url))
const modulesDir = join(root, 'modules')
const full = process.argv.includes('--report')

// Tooling every module may use without it being part of the module graph (not compared with a manifest's dependsOn)
const INFRA = new Set(['kit', 'log'])
// db schema file → the module that owns its tables (null: no module owns them yet)
const FILE_OWNER = { themes: 'theme', checkout: 'cart', 'rate-limits': null, 'custom-field-values': 'db' }
// Tables that belong to the core although a module's file defines them: every other table points at the shop
const CORE_TABLES = new Set(['shops'])

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
  const text = files.map(read).join('\n')
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
  mods.set(entry.name, { dir, pkgName: pkg.name, text, imported, declared, manifestFile, files })
}

const errors = []
const notes = []

// ── imports against package.json, and the package name against the folder
for (const [name, m] of mods) {
  if (short(m.pkgName) !== name) errors.push(`${name}: the package is called ${m.pkgName}, the folder ${name}`)
  for (const dep of m.imported)
    if (!m.declared.has(dep)) errors.push(`${name}: imports @shopnex/${dep} but package.json does not list it`)
  for (const dep of m.declared)
    if (mods.has(dep) && !m.imported.has(dep) && !INFRA.has(dep) && m.files.length)
      notes.push(`${name}: lists @shopnex/${dep} but src never imports it`)
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

// ── tables must be where drizzle-kit, the privacy test and this report look for them: modules/db/src/schema/*.ts, or a
// module's own src/*.schema.ts. A table in any other file would get no migration (so the migration check, finding no change,
// would pass) and would be missing from the privacy check.
for (const [name, m] of mods) {
  for (const file of m.files) {
    const where = relative(root, file)
    const allowed = /^modules\/db\/src\/schema\//.test(where) || /^modules\/[^/]+\/src\/[^/]+\.schema\.ts$/.test(where)
    if (!allowed && /\bpgTable\(/.test(read(file)))
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

// ── which module owns each table: the core db schema files, and the *.schema.ts files modules own
const tableOwner = new Map()
const tableChunks = []
const dbSchemaDir = join(modulesDir, 'db', 'src', 'schema')
const ownerOfFile = (base) => (base in FILE_OWNER ? FILE_OWNER[base] : base)
const sources = readdirSync(dbSchemaDir)
  .filter((f) => f.endsWith('.ts') && f !== 'index.ts')
  .map((f) => ({ path: join(dbSchemaDir, f), owner: ownerOfFile(f.replace(/\.ts$/, '')) }))
for (const [name, m] of mods)
  for (const f of m.files.filter((f) => f.endsWith('.schema.ts'))) sources.push({ path: f, owner: name })
for (const { path, owner } of sources) {
  const text = read(path)
  const parts = text.split(/^export const (\w+)\s*=\s*pgTable\(/m)
  for (let i = 1; i < parts.length; i += 2) {
    const tableOwnerName = CORE_TABLES.has(parts[i]) ? 'db' : owner
    tableOwner.set(parts[i], tableOwnerName)
    tableChunks.push({ table: parts[i], owner: tableOwnerName, body: parts[i + 1] })
  }
}

// ── tables a module reaches into that another module owns
const reached = []
for (const [name, m] of mods) {
  if (name === 'db') continue
  const names = new Set([...m.text.matchAll(/\bschema\.(\w+)/g)].map((x) => x[1]))
  for (const block of m.text.matchAll(/import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+'@shopnex\/db\/schema'/g))
    for (const part of block[1].split(','))
      names.add(
        part
          .trim()
          .replace(/^type\s+/, '')
          .split(/\s+as\s+/)[0],
      )
  const byOwner = new Map()
  for (const table of names) {
    const owner = tableOwner.get(table)
    if (!owner || owner === name) continue
    byOwner.set(owner, [...(byOwner.get(owner) ?? []), table])
  }
  for (const [owner, tables] of byOwner) {
    const allowed = owner === 'db' || reach(name).has(owner) || owner === null
    if (!allowed) reached.push({ module: name, owner, tables })
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
  return mods.has(from) && mods.has(to) && !reach(from).has(to) && from !== to && to !== 'db' && from !== 'db'
})

// ── output
const list = (items, indent = '  ') => items.map((i) => `${indent}${i}`).join('\n')
console.log(`${mods.size} modules, ${[...mods.values()].filter((m) => m.manifestFile).length} with a manifest.`)
if (notes.length) console.log(`\nNotes (${notes.length}):\n${list(notes)}`)
console.log(
  `\nTables reached across modules, owner not a dependency (${reached.length}): what moving tables must solve${full ? '' : ' (--report lists them)'}`,
)
if (full) console.log(list(reached.map((r) => `${r.module} → ${r.owner}: ${r.tables.join(', ')}`)))
console.log(`\nForeign keys against the graph (${against.length})${full ? '' : ' (--report lists them)'}`)
if (full) console.log(list(against.map(([key, fks]) => `${key}  (${fks.join('; ')})`)))
if (errors.length) {
  console.error(`\nErrors (${errors.length}):\n${list(errors)}`)
  process.exit(1)
}
console.log('\nThe module graph is consistent.')

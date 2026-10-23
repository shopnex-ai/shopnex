// Wipes the database and seeds the demo again: drops every table, re-runs the migrations, runs demo-seed.
//   DATABASE_URL=postgres://... pnpm demo:reset --yes
// DESTRUCTIVE: only for the public demo database. Signed-in visitors are signed out, uploaded files are kept.
// It never reads .env (so it can't hit your dev database by accident) and refuses localhost without --allow-local.
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { db } from '@shopnex/db'

if (!process.argv.includes('--yes')) {
  console.error('This DROPS ALL DATA in DATABASE_URL and reseeds the demo. Re-run with --yes to confirm.')
  process.exit(1)
}

const url = process.env.DATABASE_URL
if (!url) {
  console.error('Set DATABASE_URL explicitly; this script does not read .env.')
  process.exit(1)
}
const { hostname, pathname } = new URL(url)
if (['localhost', '127.0.0.1', '::1'].includes(hostname) && !process.argv.includes('--allow-local')) {
  console.error(`DATABASE_URL points at ${hostname}${pathname}. Add --allow-local if you really mean to wipe it.`)
  process.exit(1)
}
// Checked before anything is dropped: demo-seed needs these, and failing after the wipe leaves an empty database
if (!process.env.DEMO_OWNER_EMAIL || !process.env.DEMO_OWNER_PASSWORD) {
  console.error('Set DEMO_OWNER_EMAIL and DEMO_OWNER_PASSWORD first (nothing was changed).')
  process.exit(1)
}
console.log(`Resetting ${hostname}${pathname}`)

const root = fileURLToPath(new URL('../../..', import.meta.url))

// "drizzle" holds the migration journal, so dropping it makes the migrations run from scratch
await db.$client.query('drop schema if exists drizzle cascade; drop schema public cascade; create schema public;')
await db.$client.end()

const run = (args: string[]) => execFileSync('pnpm', args, { cwd: root, stdio: 'inherit', env: process.env })
run(['db:migrate'])
run(['--filter', '@shopnex/api', 'demo:seed'])

import { defineConfig } from 'drizzle-kit'
import { SCHEMA } from './src/schema'

// `pnpm generate` diffs src/schema.ts against the last migration: it needs no database
export default defineConfig({
  schema: './src/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  schemaFilter: [SCHEMA],
  migrations: { schema: SCHEMA },
})

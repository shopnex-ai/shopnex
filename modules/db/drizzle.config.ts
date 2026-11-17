import { config } from 'dotenv'
import { defineConfig } from 'drizzle-kit'

config({ path: '../../.env' })

export default defineConfig({
  // The core tables, and every module's own (modules/<name>/src/*.schema.ts): one migration history for all of them
  schema: ['./src/schema/index.ts', '../*/src/*.schema.ts'],
  out: './migrations',
  dialect: 'postgresql',
  dbCredentials: { url: process.env.DATABASE_URL! },
})

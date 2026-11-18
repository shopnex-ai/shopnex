import { config } from 'dotenv'
import { defineConfig } from 'drizzle-kit'

config({ path: '../../.env' })

export default defineConfig({
  // Every module's own tables (modules/<name>/src/*.schema.ts): one migration history for all of them
  schema: ['../*/src/*.schema.ts'],
  out: './migrations',
  dialect: 'postgresql',
  dbCredentials: { url: process.env.DATABASE_URL! },
})

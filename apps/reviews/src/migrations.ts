import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/** The drizzle/ folder: next to the bundle in the container image (scripts/bundle-app.mjs copies it), else the app's own */
export function migrationsFolder() {
  for (const path of ['./drizzle', '../drizzle']) {
    const folder = fileURLToPath(new URL(path, import.meta.url))
    if (existsSync(folder)) return folder
  }
  throw new Error('The drizzle/ migrations folder is missing')
}

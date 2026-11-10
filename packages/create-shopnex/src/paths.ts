import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { UsageError } from './errors'

/** The shop's folder: the name as given, relative to the folder you run it from (a path like ../shop or ~/shop works too) */
export function resolveShopDir(name: string, cwd = process.cwd()) {
  const trimmed = name.trim()
  if (!trimmed) throw new UsageError('The shop name cannot be empty.')
  const expanded = trimmed === '~' ? homedir() : trimmed.startsWith('~/') ? join(homedir(), trimmed.slice(2)) : trimmed
  return resolve(cwd, expanded)
}

/** Where the downloaded builds are unpacked, one folder per version. SHOPNEX_APP_DIR overrides it. */
export const appCacheDir = () => process.env.SHOPNEX_APP_DIR ?? join(homedir(), '.shopnex', 'app')

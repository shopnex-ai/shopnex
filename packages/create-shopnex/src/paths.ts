import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

/** Where the embedded database lives unless --data says otherwise: the same shop whichever folder you run it from */
export const defaultDataDir = () => join(homedir(), '.shopnex', 'data')

export function resolveDataDir(option: string | undefined) {
  if (!option) return defaultDataDir()
  const expanded = option === '~' ? homedir() : option.startsWith('~/') ? join(homedir(), option.slice(2)) : option
  return resolve(expanded)
}

/** The DATABASE_URL that makes the server use the embedded database in that folder */
export const databaseUrl = (dataDir: string) => `pglite:${dataDir}`

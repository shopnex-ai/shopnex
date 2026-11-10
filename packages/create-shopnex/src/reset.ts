import { existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { UsageError } from './errors'

/**
 * --reset: delete the embedded database folder to start from an empty shop. Refuses a folder that is not a
 * PGlite database (no PG_VERSION inside), so a wrong --data can never wipe something else, and needs --yes.
 */
export function resetData(dataDir: string, { yes }: { yes: boolean }) {
  if (!existsSync(dataDir)) return 'nothing to delete'
  if (!existsSync(join(dataDir, 'PG_VERSION'))) {
    throw new UsageError(
      `${dataDir} does not look like a ShopNex database folder (no PG_VERSION inside), so it was not deleted.`,
    )
  }
  if (!yes) throw new UsageError(`--reset deletes ${dataDir} and everything in it. Add --yes to confirm.`)
  rmSync(dataDir, { recursive: true, force: true })
  return `deleted ${dataDir}`
}

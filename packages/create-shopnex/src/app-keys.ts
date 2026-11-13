import { generateKeyPairSync } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { Extra } from './extras'

/** A new app private key, in the format of @shopnex/marketplace-sdk/keys: snxk_ + base64url(PKCS#8) */
const newAppKey = () =>
  `snxk_${generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64url')}`

/**
 * Each optional app is its own app with its own identity (its <NAME>_APP_KEY). The key is kept in the shop folder,
 * <shop>/apps/<name>/app-key, so the same shop keeps the same app and its merchants stay connected. A dry run makes
 * nothing: an app without a key yet gets an empty one.
 */
export function loadAppKeys(shopDir: string, extras: Extra[], { write }: { write: boolean }): Record<string, string> {
  const keys: Record<string, string> = {}
  for (const extra of extras) {
    const file = join(shopDir, 'apps', extra.dir, 'app-key')
    if (!existsSync(file)) {
      if (!write) {
        keys[extra.name] = ''
        continue
      }
      mkdirSync(dirname(file), { recursive: true })
      writeFileSync(file, newAppKey(), { mode: 0o600, flag: 'wx' })
    }
    chmodSync(file, 0o600)
    keys[extra.name] = readFileSync(file, 'utf8').trim()
  }
  return keys
}

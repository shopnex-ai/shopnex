// The visitor consent runtime (src/runtime/consent.ts, built to built/consent.js). It is served with
// ?v={modified time}, like a theme's own assets, so browsers and the CDN keep it for good.
import { readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const file = join('built', 'consent.js')
let version: string | undefined

export function consentScriptUrl() {
  if (version === undefined || import.meta.env.DEV) {
    try {
      version = Math.floor(statSync(file).mtimeMs).toString(36)
    } catch {
      version = ''
    }
  }
  return `/shopnex/consent.js${version ? `?v=${version}` : ''}`
}

export const readConsentScript = () => readFileSync(file)

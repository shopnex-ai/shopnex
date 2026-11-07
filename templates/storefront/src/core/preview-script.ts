// The theme editor's preview connector (src/runtime/preview.ts, built to built/preview.js). It is served with
// ?v={modified time}, like a theme's own assets, so browsers and the CDN keep it for good.
import { readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const file = join('built', 'preview.js')
let version: string | undefined

export function previewScriptUrl() {
  if (version === undefined || import.meta.env.DEV) {
    try {
      version = Math.floor(statSync(file).mtimeMs).toString(36)
    } catch {
      version = ''
    }
  }
  return `/shopnex/preview.js${version ? `?v=${version}` : ''}`
}

export const readPreviewScript = () => readFileSync(file)

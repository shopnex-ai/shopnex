import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { isEdge } from './bundle'

const GITIGNORE = `# ShopNex: secrets and local data stay out of git
.env
.pglite/
apps/*/.pglite/
apps/*/app-key
`

/** The compose file of the self-hosting docs, from the tag of this version (the latest main for an edge build) */
export const composeUrl = (version: string) =>
  `https://raw.githubusercontent.com/shopnex-ai/shopnex/${isEdge(version) ? 'main' : `v${version}`}/deploy/docker-compose.yml`

/**
 * Files a new shop folder starts with. An existing file is the user's and is never touched. The compose file is
 * fetched: when that fails (offline) the shop still starts without it, and the reason is returned.
 */
export async function writeScaffold(
  shopDir: string,
  version: string,
  fetcher: typeof fetch = fetch,
): Promise<string | undefined> {
  mkdirSync(shopDir, { recursive: true })
  const gitignore = join(shopDir, '.gitignore')
  if (!existsSync(gitignore)) writeFileSync(gitignore, GITIGNORE)

  const compose = join(shopDir, 'docker-compose.yml')
  if (existsSync(compose)) return
  const url = composeUrl(version)
  try {
    const response = await fetcher(url, { signal: AbortSignal.timeout(5000) })
    if (!response.ok) return `docker-compose.yml was not added: ${url} answered ${response.status}`
    writeFileSync(compose, await response.text())
  } catch (error) {
    return `docker-compose.yml was not added: ${url} could not be fetched (${error instanceof Error ? error.message : error})`
  }
}

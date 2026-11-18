import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { isEdge } from '@shopnex/cli-core/bundle'
import { readme } from './readme'

const GITIGNORE = `# ShopNex: secrets and local data stay out of git
.env
.pglite/
apps/*/.pglite/
apps/*/app-key
`

/** package.json: `npm start` runs this shop again, with the same create-shopnex version that made the folder, fetched by npx (nothing to install) */
const packageJson = (name: string, version: string) => {
  const run = `npx --yes create-shopnex@${version} .`
  return (
    JSON.stringify(
      {
        name:
          name
            .toLowerCase()
            .replace(/[^a-z0-9._-]+/g, '-')
            .replace(/^[._-]+/, '') || 'shopnex-shop',
        private: true,
        scripts: { start: run, dev: run },
      },
      null,
      2,
    ) + '\n'
  )
}

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

  const pkgFile = join(shopDir, 'package.json')
  if (!existsSync(pkgFile)) writeFileSync(pkgFile, packageJson(basename(shopDir), version))

  const readmeFile = join(shopDir, 'README.md')
  if (!existsSync(readmeFile)) writeFileSync(readmeFile, readme(basename(shopDir)))

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

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { UsageError } from '@shopnex/cli-core/errors'

/** The kinds of thing `shopnex generate` can make */
export const KINDS = ['app'] as const

/** The files of templates/app-starter that are copied as they are (the rest of the app is written below) */
export const STARTER_FILES = ['src/server.tsx', '.env.example', '.gitignore'] as const

// The build bundles the starter's files into __APP_STARTER__; from the sources (tsx) they are read from the template
declare const __APP_STARTER__: Record<string, string> | undefined
const starterFile = (path: string): string =>
  typeof __APP_STARTER__ !== 'undefined'
    ? (__APP_STARTER__[path] ?? '')
    : readFileSync(new URL(`../../../templates/app-starter/${path}`, import.meta.url), 'utf8')

/** A folder name that is also a fine npm package name */
export function checkName(name: string | undefined) {
  if (!name) throw new UsageError('Give the app a name: shopnex generate app <name>')
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(basename(name))) {
    throw new UsageError(`"${name}" is not a usable app name: use lowercase letters, numbers, - and _.`)
  }
}

const title = (name: string) => {
  const words = basename(name).replace(/[-_.]+/g, ' ')
  return words.charAt(0).toUpperCase() + words.slice(1)
}

/** The files of a new app: the starter's own, plus a package.json and tsconfig.json that stand on their own */
export function appFiles(name: string, version: string): Record<string, string> {
  const id = basename(name)
  const files: Record<string, string> = {}
  for (const path of STARTER_FILES) files[path] = starterFile(path)
  files['src/server.tsx'] = files['src/server.tsx']!.replaceAll('App starter', title(name))
  files['package.json'] =
    JSON.stringify(
      {
        name: id,
        private: true,
        type: 'module',
        scripts: {
          dev: 'tsx watch --env-file-if-exists=.env src/server.tsx',
          start: 'tsx --env-file-if-exists=.env src/server.tsx',
          typecheck: 'tsc',
        },
        dependencies: { '@hono/node-server': '^2.1.6', '@shopnex/app': `^${version}`, hono: '^4.13.17' },
        devDependencies: { '@types/node': '^22.20.5', tsx: '^4.23.15', typescript: '5.9.3' },
      },
      null,
      2,
    ) + '\n'
  files['tsconfig.json'] =
    JSON.stringify(
      {
        compilerOptions: {
          target: 'ES2022',
          lib: ['ES2022', 'DOM'],
          module: 'ESNext',
          moduleResolution: 'Bundler',
          strict: true,
          noUncheckedIndexedAccess: true,
          esModuleInterop: true,
          skipLibCheck: true,
          isolatedModules: true,
          noEmit: true,
          jsx: 'react-jsx',
          jsxImportSource: 'hono/jsx',
          types: ['node'],
        },
        include: ['src'],
      },
      null,
      2,
    ) + '\n'
  files['README.md'] = `# ${title(name)}

A ShopNex app, made with \`npx shopnex generate app ${id}\`.

## Run it

1. \`cp .env.example .env\`, then fill in \`SHOPNEX_CLIENT_ID\` and \`SHOPNEX_APP_KEY\` from your app's page in the
   marketplace developer dashboard (or Admin → Apps → Custom apps).
2. \`pnpm install\` (or npm, yarn), then \`pnpm dev\`.
3. Register \`http://localhost:4500\` as the App URL, install the app from the admin, and open it there.

\`src/server.tsx\` is the whole app: a page inside the admin, an endpoint that saves a note in the shop's app data,
and an \`order.created\` webhook.
`
  return files
}

/**
 * Writes a new app into `<dir>/apps/<name>` when `dir` is a shop folder (it has the .env create-shopnex wrote), and
 * into `<dir>/<name>` otherwise. An existing folder must be empty. Returns the folder.
 */
export function generateApp({ name, dir, version }: { name: string | undefined; dir: string; version: string }) {
  checkName(name)
  const folder = resolve(existsSync(join(dir, '.env')) ? join(dir, 'apps') : dir, name!)
  if (existsSync(folder) && readdirSync(folder).length > 0) {
    throw new UsageError(`${folder} is not empty. Pick another name, or empty the folder.`)
  }
  for (const [path, content] of Object.entries(appFiles(name!, version))) {
    const file = join(folder, path)
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, content)
  }
  return folder
}

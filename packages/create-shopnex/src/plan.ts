import { join } from 'node:path'
import type { Extra } from './extras'

export type ProcessPlan = {
  name: string
  cwd: string
  command: string
  args: string[]
  env: Record<string, string>
  /** Answers (status below 500) once the process is ready */
  readyUrl: string
}

export type Plan = {
  appUrl: string
  storefrontUrl: string
  processes: ProcessPlan[]
}

/**
 * The two processes to start from the packaged build (see bundle.ts): the bundled admin and the built storefront, in
 * production mode and on this machine only (HOST=127.0.0.1: a fresh install lets whoever reaches it create the owner).
 */
export function planFromBundle(input: {
  root: string
  shopDir: string
  databaseUrl: string
  port: number
  storefrontPort: number
  secret: string
  env: Record<string, string>
  extras: Extra[]
  /** The private key of each optional app, by name (see app-keys.ts) */
  appKeys?: Record<string, string>
}): Plan {
  const { root, shopDir, databaseUrl, port, storefrontPort, secret, env, extras, appKeys = {} } = input
  const extraUrl = (extra: Extra) => `http://localhost:${extra.port}`
  const appUrl = `http://localhost:${port}`
  return {
    appUrl,
    storefrontUrl: `http://localhost:${storefrontPort}`,
    processes: [
      {
        name: 'admin',
        cwd: join(root, 'admin'),
        command: process.execPath,
        args: ['server.mjs'],
        env: {
          // The shop's .env first: what the CLI decides (address, ports, the build's files) wins over it
          ...env,
          NODE_ENV: 'production',
          HOST: '127.0.0.1',
          PORT: String(port),
          DATABASE_URL: databaseUrl,
          SHOPNEX_MIGRATIONS_DIR: join(root, 'migrations'),
          // PostgreSQL from the shop's .env is migrated at start, like the embedded database
          SHOPNEX_AUTO_MIGRATE: 'true',
          SHOPNEX_SECRET: secret,
          BETTER_AUTH_URL: appUrl,
          APP_URL: appUrl,
          // Where the admin finds the storefront (Themes, the theme editor) until a Storefront URL is saved in Settings
          STOREFRONT_URL: `http://localhost:${storefrontPort}`,
          // The admin registers an optional app when its address is set (the same variable the app reads)
          ...Object.fromEntries(extras.map((extra) => [extra.urlEnv, extraUrl(extra)])),
        },
        readyUrl: `http://127.0.0.1:${port}/api/v1/health`,
      },
      {
        name: 'storefront',
        cwd: join(root, 'storefront'),
        command: process.execPath,
        args: ['dist/server/entry.mjs'],
        env: {
          NODE_ENV: 'production',
          HOST: '127.0.0.1',
          PORT: String(storefrontPort),
          COMMERCE_PROVIDER: 'shopnex',
          SHOPNEX_URL: appUrl,
          SHOPNEX_PUBLIC_URL: appUrl,
        },
        readyUrl: `http://127.0.0.1:${storefrontPort}/`,
      },
      ...extras.map((extra): ProcessPlan => ({
        name: extra.name,
        cwd: join(root, 'apps', extra.dir),
        command: process.execPath,
        args: ['server.mjs'],
        env: {
          NODE_ENV: 'production',
          HOST: '127.0.0.1',
          PORT: String(extra.port),
          [extra.urlEnv]: extraUrl(extra),
          SHOPNEX_INTERNAL_URL: appUrl,
          // Its identity, kept with the shop so the same shop stays connected
          [extra.keyEnv]: appKeys[extra.name] ?? '',
          // Tables of its own: a schema in the shop's PostgreSQL, or its own embedded database
          ...(extra.database && {
            APP_DATABASE_URL: databaseUrl.startsWith('pglite:')
              ? `pglite:${join(shopDir, 'apps', extra.dir, 'pglite')}`
              : databaseUrl,
          }),
        },
        readyUrl: `http://127.0.0.1:${extra.port}/shopnex/app.js`,
      })),
    ],
  }
}

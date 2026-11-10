import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { UsageError } from './errors'
import { databaseUrl } from './paths'

const REQUIRED = [
  'apps/admin-ui/package.json',
  'templates/storefront/package.json',
  'modules/db/migrations/meta/_journal.json',
]

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
  /** Ports to check are free, with the flag that changes each */
  ports: { port: number; flag: string }[]
  processes: ProcessPlan[]
}

/** Is this folder a ShopNex checkout with what the two servers need? Returns its absolute path. */
export function checkCheckout(from: string) {
  const root = resolve(from)
  const missing = REQUIRED.filter((file) => !existsSync(join(root, file)))
  if (missing.length) {
    throw new UsageError(`${root} does not look like a ShopNex checkout (missing ${missing.join(', ')}).`)
  }
  return root
}

/**
 * The two processes to start from a checkout, in development mode (what `pnpm dev` runs): the admin, API and
 * checkout on the embedded database, and the storefront pointed at it. Pure, so it can be shown and tested.
 */
export function planFromCheckout(input: { root: string; dataDir: string; port: number; storefrontPort: number }): Plan {
  const { root, dataDir, port, storefrontPort } = input
  const appUrl = `http://localhost:${port}`
  return {
    appUrl,
    storefrontUrl: `http://localhost:${storefrontPort}`,
    ports: [
      { port, flag: '--port' },
      { port: storefrontPort, flag: '--storefront-port' },
    ],
    processes: [
      {
        name: 'admin',
        cwd: join(root, 'apps/admin-ui'),
        command: 'pnpm',
        args: ['exec', 'vite', 'dev', '--port', String(port), '--strictPort'],
        env: { DATABASE_URL: databaseUrl(dataDir), BETTER_AUTH_URL: appUrl, APP_URL: appUrl },
        readyUrl: `${appUrl}/api/v1/health`,
      },
      {
        name: 'storefront',
        cwd: join(root, 'templates/storefront'),
        command: 'pnpm',
        // --ignore-lock: a plain foreground server. Without it Astro detaches into a background daemon when it
        // thinks an AI agent runs it, and this CLI (which supervises the processes itself) would see it exit
        args: ['exec', 'astro', 'dev', '--port', String(storefrontPort), '--ignore-lock'],
        env: { COMMERCE_PROVIDER: 'shopnex', SHOPNEX_URL: appUrl, SHOPNEX_PUBLIC_URL: appUrl },
        readyUrl: `http://localhost:${storefrontPort}/`,
      },
    ],
  }
}

/**
 * The same two processes from the packaged build (see bundle.ts): the bundled admin and the built storefront, in
 * production mode and on this machine only (HOST=127.0.0.1: a fresh install lets whoever reaches it create the owner).
 */
export function planFromBundle(input: {
  root: string
  dataDir: string
  port: number
  storefrontPort: number
  secret: string
}): Plan {
  const { root, dataDir, port, storefrontPort, secret } = input
  const appUrl = `http://localhost:${port}`
  return {
    appUrl,
    storefrontUrl: `http://localhost:${storefrontPort}`,
    ports: [
      { port, flag: '--port' },
      { port: storefrontPort, flag: '--storefront-port' },
    ],
    processes: [
      {
        name: 'admin',
        cwd: join(root, 'admin'),
        command: process.execPath,
        args: ['server.mjs'],
        env: {
          NODE_ENV: 'production',
          HOST: '127.0.0.1',
          PORT: String(port),
          DATABASE_URL: databaseUrl(dataDir),
          SHOPNEX_MIGRATIONS_DIR: join(root, 'migrations'),
          SHOPNEX_SECRET: secret,
          BETTER_AUTH_URL: appUrl,
          APP_URL: appUrl,
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
    ],
  }
}

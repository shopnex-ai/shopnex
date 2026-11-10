import { join } from 'node:path'
import { databaseUrl } from './paths'

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
          // Where the admin finds the storefront (Themes, the theme editor) until a Storefront URL is saved in Settings
          STOREFRONT_URL: `http://localhost:${storefrontPort}`,
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

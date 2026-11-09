// Every environment variable the ShopNex server reads (modules/*/src and apps/admin-ui/src), with what the docs
// say about it. The Configuration page is generated from this. tests/env-vars.test.ts fails when code reads a
// variable that is not listed here, or a listed one is no longer read, so the page cannot drift from the code.

export type EnvVar = {
  /** Name, or a pattern like `<NAME>_APP_INTERNAL_URL` (never matched against the code) */
  name: string
  required: boolean
  /** What it falls back to, when that is worth saying */
  default?: string
  /** Markdown */
  description: string
}

export const ENV_VARS: EnvVar[] = [
  { name: 'DATABASE_URL', required: true, description: 'PostgreSQL connection string.' },
  {
    name: 'SHOPNEX_SECRET',
    required: true,
    description:
      "Long random string. Signs sessions, encrypts provider keys at rest and signs preview links. Generated into `/data` when unset. Keep it: stored keys can't be read without it.",
  },
  {
    name: 'BETTER_AUTH_SECRET',
    required: false,
    default: 'derived from `SHOPNEX_SECRET`',
    description: 'Signs sessions. Set it only to keep the sessions of an install that already uses it.',
  },
  {
    name: 'APP_URL',
    required: true,
    description:
      'Public origin of the app, e.g. `https://shop.example.com`. Also used in hosted checkout links and OAuth callbacks.',
  },
  {
    name: 'BETTER_AUTH_URL',
    required: false,
    description: 'The old name of `APP_URL`, still read when `APP_URL` is unset.',
  },
  {
    name: 'TENANCY_MODE',
    required: false,
    default: 'single',
    description: '`single` or `multi`. See [Tenancy](/docs/concepts/tenancy).',
  },
  { name: 'DEFAULT_SHOP_NAME', required: false, default: 'My Shop', description: 'Name of the default shop.' },
  {
    name: 'OPEN_SIGNUP',
    required: false,
    default: 'false',
    description:
      '`true` lets anyone create an account and a shop at `/admin/signup`. Multi-shop mode only. See [Tenancy](/docs/concepts/tenancy).',
  },
  {
    name: 'ROOT_DOMAIN',
    required: false,
    description:
      'Multi-shop mode only: every shop is also served at `<slug>.ROOT_DOMAIN`. Needs wildcard DNS and TLS for `*.ROOT_DOMAIN`. See [Tenancy](/docs/concepts/tenancy).',
  },
  {
    name: 'SIGNUP_RATE_PER_IP',
    required: false,
    default: '5',
    description: 'Open sign-ups allowed per hour from one visitor address.',
  },
  {
    name: 'SIGNUP_RATE_GLOBAL',
    required: false,
    default: '200',
    description: 'Open sign-ups allowed per hour for everyone together.',
  },
  {
    name: 'CLIENT_IP_HEADER',
    required: false,
    default: 'x-forwarded-for',
    description:
      "The request header that carries the visitor's address, for the sign-up limits: `cf-connecting-ip` behind Cloudflare. Without an address only the global cap applies.",
  },
  { name: 'GOOGLE_CLIENT_ID', required: false, description: 'Enables Google sign-in (with `GOOGLE_CLIENT_SECRET`).' },
  { name: 'GOOGLE_CLIENT_SECRET', required: false, description: 'Enables Google sign-in (with `GOOGLE_CLIENT_ID`).' },
  { name: 'GITHUB_CLIENT_ID', required: false, description: 'Enables GitHub sign-in (with `GITHUB_CLIENT_SECRET`).' },
  { name: 'GITHUB_CLIENT_SECRET', required: false, description: 'Enables GitHub sign-in (with `GITHUB_CLIENT_ID`).' },
  {
    name: 'STOREFRONT_URL',
    required: false,
    description:
      'Storefront origin used when no Storefront URL is saved in Settings (single-shop installs only). `pnpm dev` sets it to the bundled storefront.',
  },
  {
    name: 'FILES_DIR',
    required: false,
    default: '.data/files',
    description: 'Where uploaded files are stored when the shop has no S3 storage configured.',
  },
  {
    name: 'MARKETPLACE_URL',
    required: false,
    default: 'https://apps.shopnex.com',
    description: 'App Marketplace instances connect to.',
  },
  {
    name: 'STRIPE_APP_URL',
    required: false,
    description:
      'Public URL of the bundled Stripe app, e.g. `https://stripe.example.com`. Under Docker set it on the `stripe` service (the app announces it to ShopNex); defaults to `https://stripe.<DOMAIN>` when `DOMAIN` is set in the deploy compose file, else `http://localhost:4600`. Without Docker, set it on ShopNex too.',
  },
  {
    name: 'CJ_DROPSHIPPING_APP_URL',
    required: false,
    description:
      "Public URL of the optional CJ Dropshipping app. Under Docker set it on the app's own service (custom domain); ShopNex finds the app itself; defaults to `https://cj.<DOMAIN>` when `DOMAIN` is set in the deploy compose file. Without Docker, set it on ShopNex too.",
  },
  {
    name: 'SHIPPO_APP_URL',
    required: false,
    description: 'Public URL of the optional Shippo app. Set it on ShopNex to make the app installable.',
  },
  {
    name: 'SHOPNEX_BUNDLED_APPS',
    required: false,
    description:
      'Set to `docker` and ShopNex looks for the bundled apps at their Compose service names (`stripe:4600`, `cj-dropshipping:4700`); each app announces its own public URL. The Compose files set it.',
  },
  {
    name: '<NAME>_APP_INTERNAL_URL',
    required: false,
    description:
      "For other networks: the address ShopNex's server uses to reach an app whose public URL it cannot reach, e.g. `STRIPE_APP_INTERNAL_URL=http://stripe:4600`. Apps use `SHOPNEX_INTERNAL_URL` for calls back to ShopNex.",
  },
  {
    name: 'SHOPNEX_UPDATE_CHECK',
    required: false,
    description:
      "Set to `false` to stop super admins' dashboards asking GitHub for new releases. Updates are never applied automatically.",
  },
]

/** Read by the server but set by the Docker image or the release process, not by operators */
export const INTERNAL_ENV_VARS = ['NODE_ENV', 'APP_VERSION', 'SHOPNEX_UPDATER_DIR'] as const

interface ImportMetaEnv {
  /** Shopnex origin (set by `pnpm dev` from the repo root) */
  readonly SHOPNEX_URL?: string
  /** Shopnex origin as buyers' browsers reach it (cart, checkout), when it differs from SHOPNEX_URL */
  readonly SHOPNEX_PUBLIC_URL?: string
  /** pk_… from the admin; optional in single-tenant mode */
  readonly SHOPNEX_PUBLISHABLE_KEY?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

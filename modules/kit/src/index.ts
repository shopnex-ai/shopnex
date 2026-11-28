// What a module declares about itself, in `src/<name>.module.ts`. A plain object, no decorators and no injection: it is
// read by the composition root (modules/api) and by `pnpm modules:check`, and it keeps the module graph in one readable
// place. Add a field here only when a second module needs it.
import type { AnyPgTable } from 'drizzle-orm/pg-core'
export * from './errors'
export * from './conn'
export * from './hooks'

export interface ModuleManifest {
  /** The folder name under modules/ (`custom-fields`) */
  name: string
  /** The modules this one imports, by folder name. `pnpm modules:check` compares it with the real imports and package.json */
  dependsOn: readonly string[]
  /** The tables it owns, from its `*.schema.ts` files (migrations stay one history in modules/db) */
  tables?: Readonly<Record<string, AnyPgTable>>
  /** Its Admin API routes. Typed by the module: modules/api mounts it by name so the client types stay end to end */
  router?: object
}

/** Returns the manifest unchanged, with its own type: `module.router` keeps the router's exact type for the typed client */
export function defineModule<const M extends ModuleManifest>(manifest: M): M {
  return manifest
}

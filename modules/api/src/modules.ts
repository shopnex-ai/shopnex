// The modules that declare themselves with a manifest (`<name>.module.ts`). A module joins by being listed here; the
// routes are still mounted by name in router.ts, so the typed client and the generated API types keep their exact types.
import { customFieldsModule } from '@shopnex/custom-fields/module'
import { pricingModule } from '@shopnex/pricing/module'
import type { ModuleManifest } from '@shopnex/kit'
import { firstMapper } from '@shopnex/rpc'

export const modules = [customFieldsModule, pricingModule] as const

const manifests: readonly ModuleManifest[] = modules

/** The error mappers of the listed modules, tried one after the other */
export const moduleErrors = firstMapper(...manifests.flatMap((manifest) => (manifest.errors ? [manifest.errors] : [])))

import { UnavailableError } from './errors'

/**
 * Where the server to run comes from when there is no checkout (--from).
 *
 * Planned: the release workflow attaches a Node bundle of the built admin app, the built storefront with its
 * themes, and the database migrations to each GitHub release (shopnex-<version>-node.tgz). This downloads the
 * one matching this package's version into ~/.shopnex/app/<version> once, checks its checksum, and returns the
 * folder to run from. None of that is published yet.
 */
export async function resolveBundle(): Promise<never> {
  throw new UnavailableError(
    'Running without a checkout is not available yet: the packaged build of ShopNex is not published.\n' +
      'For now, point --from at a ShopNex checkout:  create-shopnex --from /path/to/shopnex',
  )
}

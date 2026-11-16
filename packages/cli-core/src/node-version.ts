import { UsageError } from './errors'

/** "22.22.0" against a minimum: true when it is the same or newer (compared as numbers, so 22.100 > 22.22) */
export const atLeast = (version: string, minimum: string) =>
  version.replace(/^v/, '').localeCompare(minimum, undefined, { numeric: true }) >= 0

export function assertNode(version: string, enginesRange: string) {
  const minimum = enginesRange.replace(/^>=/, '')
  if (!atLeast(version, minimum)) {
    throw new UsageError(
      `ShopNex needs Node ${minimum} or newer, this is ${version}. Install a newer Node (https://nodejs.org) and run it again.`,
    )
  }
}

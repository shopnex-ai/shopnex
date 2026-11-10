import { UsageError } from './errors'

const parts = (version: string) =>
  version
    .replace(/^v/, '')
    .split('.')
    .map((n) => Number.parseInt(n, 10) || 0)

/** "22.22.0" against a minimum like "22.22.0": true when it is the same or newer */
export function atLeast(version: string, minimum: string) {
  const have = parts(version)
  const need = parts(minimum)
  for (let i = 0; i < 3; i++) {
    const [a, b] = [have[i] ?? 0, need[i] ?? 0]
    if (a !== b) return a > b
  }
  return true
}

export function assertNode(version: string, enginesRange: string) {
  const minimum = enginesRange.replace(/^>=/, '')
  if (!atLeast(version, minimum)) {
    throw new UsageError(
      `ShopNex needs Node ${minimum} or newer, this is ${version}. Install a newer Node (https://nodejs.org) and run it again.`,
    )
  }
}

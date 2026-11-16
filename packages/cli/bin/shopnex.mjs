#!/usr/bin/env node
// The compiled CLI (pnpm --filter shopnex build; it is built before the package is packed). From a checkout,
// `pnpm --filter shopnex dev -- <options>` runs the TypeScript directly.
try {
  await import('../dist/main.mjs')
} catch (error) {
  if (error?.code !== 'ERR_MODULE_NOT_FOUND' || !String(error.message).includes('dist/main.mjs')) throw error
  console.error('shopnex is not built. Run: pnpm --filter shopnex build')
  process.exitCode = 1
}

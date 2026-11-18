import { readFileSync } from 'node:fs'

// The build bundles getting-started/README.md into __SHOP_README__; from the sources (tsx) it is read from the file
declare const __SHOP_README__: string | undefined
const template =
  typeof __SHOP_README__ !== 'undefined'
    ? __SHOP_README__
    : readFileSync(new URL('../getting-started/README.md', import.meta.url), 'utf8')

/** The folder name the getting-started README uses in its examples; the README of a new shop has the real one */
const EXAMPLE_NAME = 'my-shop'

/** The README.md a new shop folder starts with: getting-started/README.md, with the shop's own folder name */
export const readme = (name: string) => template.replaceAll(EXAMPLE_NAME, name)

import { readFileSync } from 'node:fs'

// The build bundles template/README.md into __SHOP_README__; from the sources (tsx) it is read from the file
declare const __SHOP_README__: string | undefined
const template =
  typeof __SHOP_README__ !== 'undefined'
    ? __SHOP_README__
    : readFileSync(new URL('../template/README.md', import.meta.url), 'utf8')

/** The README.md a new shop folder starts with (template/README.md): how to run it again and what the files are */
export const readme = (name: string) => template.replaceAll('{{name}}', name)

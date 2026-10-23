import { createFromSource } from 'fumadocs-core/search/server'
import { source } from '@/lib/source'

// Static export: the index is built once and served as a file; the client searches it in the browser
export const revalidate = false

export const { staticGET: GET } = createFromSource(source)

import { pageSchema } from 'fumadocs-core/source/schema'
import { defineConfig, defineDocs } from 'fumadocs-mdx/config'
import { z } from 'zod'

export const docs = defineDocs({
  dir: 'content/docs',
  docs: {
    schema: pageSchema.extend({
      // Set only after someone ran the page's steps end to end, e.g.
      //   verified: 2026-11-03
      //   verifiedVersion: v0.4.0
      verified: z.coerce.date().optional(),
      verifiedVersion: z.string().optional(),
    }),
  },
})

export default defineConfig()

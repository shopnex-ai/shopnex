import { createMDX } from 'fumadocs-mdx/next'

const withMDX = createMDX()
const dev = process.env.NODE_ENV === 'development'

/** @type {import('next').NextConfig} */
const config = {
  reactStrictMode: true,
  ...(dev
    ? {
        // `next dev` doesn't serve index.html for a public/ folder (static hosts do)
        rewrites: async () => [{ source: '/reference', destination: '/reference/index.html' }],
      }
    : {
        // Fully static site: `next build` writes it to out/
        output: 'export',
      }),
}

export default withMDX(config)

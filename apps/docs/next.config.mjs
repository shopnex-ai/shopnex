import { createMDX } from 'fumadocs-mdx/next'

const withMDX = createMDX()
const dev = process.env.NODE_ENV === 'development'

/** @type {import('next').NextConfig} */
const config = {
  reactStrictMode: true,
  // Open the dev server from another device on the network (DOCS_DEV_ORIGINS=192.168.100.3,...)
  allowedDevOrigins: process.env.DOCS_DEV_ORIGINS?.split(',')
    .map((h) => h.trim())
    .filter(Boolean),
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

import './global.css'
import { RootProvider } from 'fumadocs-ui/provider/next'
import type { ReactNode } from 'react'

export const metadata = {
  title: { template: '%s | ShopNex Docs', default: 'ShopNex Docs' },
  description: 'Documentation for ShopNex: run a shop, build storefronts and apps.',
  // The site has its own dark theme. This tells the Dark Reader extension to leave it alone, because it rewrites the
  // page before React hydrates and causes hydration mismatch errors in dev.
  other: { 'darkreader-lock': 'true' },
}

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="flex min-h-screen flex-col">
        <RootProvider search={{ options: { type: 'static' } }}>{children}</RootProvider>
      </body>
    </html>
  )
}

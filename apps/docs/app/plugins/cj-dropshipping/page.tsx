import type { Metadata } from 'next'

// Old plugin page: CJ Dropshipping and Stripe are apps now. The site is a static export, so there are no server
// redirects: an instant meta refresh (which Google treats like a permanent redirect) plus a canonical link move
// old links and search results to the app's new docs page.
const target = '/docs/apps/cj-dropshipping'

export const metadata: Metadata = {
  title: 'Moved',
  alternates: { canonical: `https://docs.shopnex.ai${target}` },
}

export default function Page() {
  return (
    <>
      <meta httpEquiv="refresh" content={`0; url=${target}`} />
      <p>
        This page moved to <a href={target}>the new page</a>.
      </p>
    </>
  )
}

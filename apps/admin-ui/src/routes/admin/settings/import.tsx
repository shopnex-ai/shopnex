import { createFileRoute } from '@tanstack/react-router'
import { PageHeader } from '@/components/admin/page-header'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { StoreImportPanel } from '@/screens/store-import/store-import-panel'

export const Route = createFileRoute('/admin/settings/import')({
  validateSearch: (search: Record<string, unknown>): { url?: string } => ({
    url: typeof search.url === 'string' ? search.url.slice(0, 300) : undefined,
  }),
  component: ImportSettingsPage,
})

function ImportSettingsPage() {
  const { url } = Route.useSearch()
  return (
    <>
      <PageHeader title="Import a store" />
      <Card>
        <CardHeader>
          <CardTitle>Import a Shopify or WooCommerce store</CardTitle>
          <CardDescription>
            Paste the address of a store and its products, collections, menus and usual pages are added to this shop.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <StoreImportPanel initialUrl={url} />
        </CardContent>
      </Card>
    </>
  )
}

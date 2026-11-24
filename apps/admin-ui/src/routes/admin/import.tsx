import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { ShopnexBrand } from '@/components/admin/shopnex-logo'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { StoreImportPanel } from '@/screens/store-import/store-import-panel'

// Onboarding right after sign-up when the visitor came with a store address (/admin/signup?import=<store>): brings the store
// across, then continues to naming the shop (already filled in from the store).
export const Route = createFileRoute('/admin/import')({
  staticData: { standalone: true },
  validateSearch: (search: Record<string, unknown>): { url?: string } => ({
    url: typeof search.url === 'string' ? search.url.slice(0, 300) : undefined,
  }),
  component: ImportOnboarding,
})

function ImportOnboarding() {
  const { url } = Route.useSearch()
  const navigate = useNavigate()
  return (
    <div className="flex min-h-svh w-full items-center justify-center p-6 md:p-10">
      <div className="w-full max-w-md">
        <ShopnexBrand />
        <Card>
          <CardHeader>
            <CardTitle>Bringing your store across</CardTitle>
            <CardDescription>Your products, collections and pages, and the look of your shop.</CardDescription>
          </CardHeader>
          <CardContent>
            <StoreImportPanel
              onboarding
              initialUrl={url}
              onContinue={() => void navigate({ to: '/admin/welcome', replace: true })}
            />
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

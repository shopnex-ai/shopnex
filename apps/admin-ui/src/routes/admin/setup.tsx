import { createFileRoute } from '@tanstack/react-router'
import { ShopnexBrand } from '@/components/admin/shopnex-logo'
import { SetupForm } from '@/screens/setup/setup-form'

export const Route = createFileRoute('/admin/setup')({
  staticData: { standalone: true },
  // /admin/setup?import=<store address> (create-shopnex --from): after creating the owner, the store is imported
  validateSearch: (search: Record<string, unknown>): { import?: string } => ({
    import: typeof search.import === 'string' ? search.import.slice(0, 300) : undefined,
  }),
  component: SetupPage,
})

function SetupPage() {
  const { import: importUrl } = Route.useSearch()
  return (
    <div className="flex min-h-svh w-full items-center justify-center p-6 md:p-10">
      <div className="w-full max-w-md">
        <ShopnexBrand />
        <SetupForm importUrl={importUrl} />
      </div>
    </div>
  )
}

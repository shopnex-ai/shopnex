import { createFileRoute } from '@tanstack/react-router'
import { ShopnexBrand } from '@/components/admin/shopnex-logo'
import { getSocialProviders } from '@/lib/session.functions'
import { SignupForm } from '@/screens/signup/signup-form'

export const Route = createFileRoute('/admin/signup')({
  staticData: { standalone: true },
  // /admin/signup?import=<store address>: after signing up, the store is imported into the new shop
  validateSearch: (search: Record<string, unknown>): { import?: string } => ({
    import: typeof search.import === 'string' ? search.import.slice(0, 300) : undefined,
  }),
  loader: () => getSocialProviders(),
  component: SignupPage,
})

function SignupPage() {
  const providers = Route.useLoaderData()
  const { import: importUrl } = Route.useSearch()
  return (
    <div className="flex min-h-svh w-full items-center justify-center p-6 md:p-10">
      <div className="w-full max-w-md">
        <ShopnexBrand />
        <SignupForm providers={providers} importUrl={importUrl} />
      </div>
    </div>
  )
}

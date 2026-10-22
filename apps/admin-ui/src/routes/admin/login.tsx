import { createFileRoute } from '@tanstack/react-router'
import { ShopnexBrand } from '@/components/admin/shopnex-logo'
import { getSocialProviders } from '@/lib/session.functions'
import { LoginForm } from '@/screens/auth/login-form'

export const Route = createFileRoute('/admin/login')({
  validateSearch: (search: Record<string, unknown>): { error?: string; next?: string } => ({
    error: typeof search.error === 'string' ? search.error : undefined,
    next: typeof search.next === 'string' ? search.next : undefined,
  }),
  loader: () => getSocialProviders(),
  component: LoginPage,
})

function LoginPage() {
  const search = Route.useSearch()
  const providers = Route.useLoaderData()
  return (
    <div className="flex min-h-svh w-full items-center justify-center p-6 md:p-10">
      <div className="w-full max-w-md">
        <ShopnexBrand />
        <LoginForm providers={providers} error={search.error} next={search.next} />
      </div>
    </div>
  )
}

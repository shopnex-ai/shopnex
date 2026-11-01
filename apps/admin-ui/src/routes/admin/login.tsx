import { createFileRoute } from '@tanstack/react-router'
import { ShopnexBrand } from '@/components/admin/shopnex-logo'
import { getDemoLogin, getSocialProviders } from '@/lib/session.functions'
import { adminContextQuery } from '@/lib/admin-context'
import { LoginForm } from '@/screens/auth/login-form'

export const Route = createFileRoute('/admin/login')({
  validateSearch: (search: Record<string, unknown>): { error?: string; next?: string; demo?: boolean } => ({
    error: typeof search.error === 'string' ? search.error : undefined,
    next: typeof search.next === 'string' ? search.next : undefined,
    // ?demo prefills the shared demo login on a demo deployment (DEMO_MODE=true)
    demo: search.demo === '' || search.demo === true || search.demo === 'true' || search.demo === 1 ? true : undefined,
  }),
  loaderDeps: ({ search }) => ({ demo: search.demo }),
  loader: async ({ deps, context }) => ({
    providers: await getSocialProviders(),
    openSignup: (await context.queryClient.ensureQueryData(adminContextQuery)).openSignup,
    demoLogin: deps.demo ? await getDemoLogin() : null,
  }),
  component: LoginPage,
})

function LoginPage() {
  const search = Route.useSearch()
  const { providers, demoLogin, openSignup } = Route.useLoaderData()
  return (
    <div className="flex min-h-svh w-full items-center justify-center p-6 md:p-10">
      <div className="w-full max-w-md">
        <ShopnexBrand />
        <LoginForm
          providers={providers}
          error={search.error}
          next={search.next}
          defaults={demoLogin}
          openSignup={openSignup}
        />
      </div>
    </div>
  )
}

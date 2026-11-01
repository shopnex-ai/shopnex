import { createFileRoute } from '@tanstack/react-router'
import { ShopnexBrand } from '@/components/admin/shopnex-logo'
import { getSocialProviders } from '@/lib/session.functions'
import { SignupForm } from '@/screens/signup/signup-form'

export const Route = createFileRoute('/admin/signup')({
  loader: () => getSocialProviders(),
  component: SignupPage,
})

function SignupPage() {
  const providers = Route.useLoaderData()
  return (
    <div className="flex min-h-svh w-full items-center justify-center p-6 md:p-10">
      <div className="w-full max-w-md">
        <ShopnexBrand />
        <SignupForm providers={providers} />
      </div>
    </div>
  )
}

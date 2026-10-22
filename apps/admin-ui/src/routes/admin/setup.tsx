import { createFileRoute } from '@tanstack/react-router'
import { ShopnexBrand } from '@/components/admin/shopnex-logo'
import { SetupForm } from '@/screens/setup/setup-form'

export const Route = createFileRoute('/admin/setup')({
  component: () => (
    <div className="flex min-h-svh w-full items-center justify-center p-6 md:p-10">
      <div className="w-full max-w-md">
        <ShopnexBrand />
        <SetupForm />
      </div>
    </div>
  ),
})

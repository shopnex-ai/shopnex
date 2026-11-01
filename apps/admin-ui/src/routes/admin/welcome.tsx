import { createFileRoute } from '@tanstack/react-router'
import { ShopnexBrand } from '@/components/admin/shopnex-logo'
import { WelcomeWizard } from '@/screens/setup/welcome-wizard'

// First-run onboarding after /admin/setup creates the owner account
export const Route = createFileRoute('/admin/welcome')({
  component: () => (
    <div className="flex min-h-svh w-full items-center justify-center p-6 md:p-10">
      <div className="w-full max-w-md">
        <ShopnexBrand />
        <WelcomeWizard />
      </div>
    </div>
  ),
})

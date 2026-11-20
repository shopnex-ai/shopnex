import { createFileRoute } from '@tanstack/react-router'
import { PageHeader } from '@/components/admin/page-header'
import { LanguagesCard } from '@/screens/settings/languages-card'

export const Route = createFileRoute('/admin/settings/languages')({ component: LanguagesSettingsPage })
function LanguagesSettingsPage() {
  return (
    <>
      <PageHeader title="Languages" description="The languages your storefront can be read in." />
      <LanguagesCard />
    </>
  )
}

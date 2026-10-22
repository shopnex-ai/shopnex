import { createFileRoute } from '@tanstack/react-router'
import { PageHeader } from '@/components/admin/page-header'
import { TaxesCard } from '@/screens/settings/taxes-card'

export const Route = createFileRoute('/admin/settings/taxes')({ component: TaxesSettingsPage })
function TaxesSettingsPage() {
  return (
    <>
      <PageHeader title="Taxes" description="Tax rates charged at checkout." />
      <TaxesCard />
    </>
  )
}

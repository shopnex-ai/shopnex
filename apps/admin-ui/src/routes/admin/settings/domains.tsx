import { createFileRoute } from '@tanstack/react-router'
import { PageHeader } from '@/components/admin/page-header'
import { DomainsCard } from '@/screens/settings/domains-card'

export const Route = createFileRoute('/admin/settings/domains')({ component: DomainsSettingsPage })
function DomainsSettingsPage() {
  return (
    <>
      <PageHeader title="Domains" description="The addresses your storefront is served on." />
      <DomainsCard />
    </>
  )
}

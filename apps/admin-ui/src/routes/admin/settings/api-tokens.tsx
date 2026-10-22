import { createFileRoute } from '@tanstack/react-router'
import { PageHeader } from '@/components/admin/page-header'
import { ApiTokensCard } from '@/screens/settings/api-tokens-card'

export const Route = createFileRoute('/admin/settings/api-tokens')({ component: ApiTokensSettingsPage })
function ApiTokensSettingsPage() {
  return (
    <>
      <PageHeader title="API tokens" description="Tokens for scripts and integrations that call the Admin API." />
      <ApiTokensCard />
    </>
  )
}

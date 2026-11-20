import { createFileRoute } from '@tanstack/react-router'
import { PageHeader } from '@/components/admin/page-header'
import { AiCard } from '@/screens/settings/ai-card'

export const Route = createFileRoute('/admin/settings/ai')({ component: AiSettingsPage })
function AiSettingsPage() {
  return (
    <>
      <PageHeader title="AI" />
      <AiCard />
    </>
  )
}

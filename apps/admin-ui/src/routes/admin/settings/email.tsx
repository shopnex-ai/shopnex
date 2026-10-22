import { createFileRoute } from '@tanstack/react-router'
import { PageHeader } from '@/components/admin/page-header'
import { EmailCard } from '@/screens/settings/email-card'

export const Route = createFileRoute('/admin/settings/email')({ component: EmailSettingsPage })
function EmailSettingsPage() {
  return (
    <>
      <PageHeader title="Email" description="How your shop sends email to customers and staff." />
      <EmailCard />
    </>
  )
}

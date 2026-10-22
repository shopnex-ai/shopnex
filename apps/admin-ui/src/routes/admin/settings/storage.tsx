import { createFileRoute } from '@tanstack/react-router'
import { PageHeader } from '@/components/admin/page-header'
import { StorageCard } from '@/screens/settings/storage-card'

export const Route = createFileRoute('/admin/settings/storage')({ component: StorageSettingsPage })
function StorageSettingsPage() {
  return (
    <>
      <PageHeader title="Storage" description="Where uploaded images and files are stored." />
      <StorageCard />
    </>
  )
}

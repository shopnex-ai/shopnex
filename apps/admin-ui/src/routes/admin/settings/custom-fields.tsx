import { createFileRoute } from '@tanstack/react-router'
import { PageHeader } from '@/components/admin/page-header'
import { CustomFieldsCard } from '@/screens/settings/custom-fields-card'

export const Route = createFileRoute('/admin/settings/custom-fields')({ component: CustomFieldsSettingsPage })
function CustomFieldsSettingsPage() {
  return (
    <>
      <PageHeader title="Custom fields" description="Add your own fields to products, orders and customers." />
      <CustomFieldsCard />
    </>
  )
}

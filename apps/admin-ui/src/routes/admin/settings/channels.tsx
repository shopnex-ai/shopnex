import { createFileRoute } from '@tanstack/react-router'
import { PageHeader } from '@/components/admin/page-header'
import { ChannelsCard } from '@/screens/settings/channels-card'

export const Route = createFileRoute('/admin/settings/channels')({ component: ChannelsSettingsPage })
function ChannelsSettingsPage() {
  return (
    <>
      <PageHeader
        title="Sales channels"
        description="Where your shop sells. Each product and collection is published on the channels you choose."
      />
      <ChannelsCard />
    </>
  )
}

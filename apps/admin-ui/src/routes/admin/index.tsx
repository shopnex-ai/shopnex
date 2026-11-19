import { createFileRoute } from '@tanstack/react-router'
import { HomeDashboard } from '@/screens/home/home-dashboard'
import { Page } from '@/components/admin/page'

export const Route = createFileRoute('/admin/')({ component: HomePage })

function HomePage() {
  const { access } = Route.useRouteContext()
  return (
    <Page>
      <HomeDashboard currency={access.tenant?.shop.currency ?? 'USD'} shopId={access.tenant?.shop.id ?? 'default'} />
    </Page>
  )
}

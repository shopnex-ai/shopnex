import { createFileRoute } from '@tanstack/react-router'
import { HomeDashboard } from '@/screens/home/home-dashboard'

export const Route = createFileRoute('/admin/')({ component: HomePage })

function HomePage() {
  const { access } = Route.useRouteContext()
  return (
    <div className="mx-auto max-w-5xl">
      <HomeDashboard currency={access.tenant?.shop.currency ?? 'USD'} />
    </div>
  )
}

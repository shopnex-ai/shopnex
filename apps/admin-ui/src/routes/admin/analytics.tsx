import { createFileRoute } from '@tanstack/react-router'
import { AnalyticsDashboard } from '@/screens/analytics/analytics-dashboard'

export const Route = createFileRoute('/admin/analytics')({ component: AnalyticsPage })

function AnalyticsPage() {
  const { access } = Route.useRouteContext()
  return (
    <div className="mx-auto max-w-5xl">
      <AnalyticsDashboard currency={access.tenant?.shop.currency ?? 'USD'} />
    </div>
  )
}

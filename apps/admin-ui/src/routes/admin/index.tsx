import { createFileRoute } from '@tanstack/react-router'
import { Today } from '@/screens/home/today'

export const Route = createFileRoute('/admin/')({ component: HomePage })

function HomePage() {
  const { access } = Route.useRouteContext()
  return (
    <div className="mx-auto max-w-5xl">
      <Today currency={access.tenant?.shop.currency ?? 'USD'} shopId={access.tenant?.shop.id ?? 'default'} />
    </div>
  )
}

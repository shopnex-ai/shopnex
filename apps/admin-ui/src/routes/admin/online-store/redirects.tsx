import { createFileRoute } from '@tanstack/react-router'
import { RedirectList } from '@/screens/online-store/redirects/redirect-list'

export const Route = createFileRoute('/admin/online-store/redirects')({ component: RedirectsPage })

function RedirectsPage() {
  return (
    <div className="mx-auto max-w-4xl">
      <RedirectList />
    </div>
  )
}

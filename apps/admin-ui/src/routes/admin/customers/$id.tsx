import { createFileRoute } from '@tanstack/react-router'
import { isShopManager } from '@/lib/admin-access'
import { CustomerDetail } from '@/screens/customers/[id]/customer-detail'

export const Route = createFileRoute('/admin/customers/$id')({ component: CustomerPage })
function CustomerPage() {
  const { id } = Route.useParams()
  const canManage = isShopManager(Route.useRouteContext().access.tenant)
  return (
    <div className="mx-auto max-w-5xl">
      <CustomerDetail id={id} canManage={canManage} />
    </div>
  )
}

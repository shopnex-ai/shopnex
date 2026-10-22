import { createFileRoute } from '@tanstack/react-router'
import { CustomerDetail } from '@/screens/customers/[id]/customer-detail'

export const Route = createFileRoute('/admin/customers/$id')({ component: CustomerPage })
function CustomerPage() {
  const { id } = Route.useParams()
  return (
    <div className="mx-auto max-w-5xl">
      <CustomerDetail id={id} />
    </div>
  )
}

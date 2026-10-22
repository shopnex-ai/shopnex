import { createFileRoute } from '@tanstack/react-router'
import { OrderDetail } from '@/screens/orders/[id]/order-detail'

export const Route = createFileRoute('/admin/orders/$id')({ component: OrderPage })
function OrderPage() {
  const { id } = Route.useParams()
  return (
    <div className="mx-auto max-w-5xl">
      <OrderDetail id={id} />
    </div>
  )
}

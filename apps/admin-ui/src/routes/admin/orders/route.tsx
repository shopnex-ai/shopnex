import { createFileRoute, Outlet, useLocation } from '@tanstack/react-router'
import { OrderList } from '@/screens/orders/order-list'

export const Route = createFileRoute('/admin/orders')({ component: OrdersRoute })

function OrdersRoute() {
  const pathname = useLocation({ select: (location) => location.pathname })
  return pathname === '/admin/orders' ? (
    <div className="mx-auto max-w-5xl">
      <OrderList />
    </div>
  ) : (
    <Outlet />
  )
}

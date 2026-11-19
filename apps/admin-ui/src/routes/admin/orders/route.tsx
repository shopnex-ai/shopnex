import { createFileRoute, Outlet, useLocation } from '@tanstack/react-router'
import { OrderList } from '@/screens/orders/order-list'
import { Page } from '@/components/admin/page'

export const Route = createFileRoute('/admin/orders')({ component: OrdersRoute })

function OrdersRoute() {
  const pathname = useLocation({ select: (location) => location.pathname })
  return pathname === '/admin/orders' ? (
    <Page>
      <OrderList />
    </Page>
  ) : (
    <Outlet />
  )
}

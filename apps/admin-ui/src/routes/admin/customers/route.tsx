import { createFileRoute, Outlet, useLocation } from '@tanstack/react-router'
import { CustomerList } from '@/screens/customers/customer-list'

export const Route = createFileRoute('/admin/customers')({ component: CustomersRoute })

function CustomersRoute() {
  const pathname = useLocation({ select: (location) => location.pathname })
  return pathname === '/admin/customers' ? (
    <div className="mx-auto max-w-5xl">
      <CustomerList />
    </div>
  ) : (
    <Outlet />
  )
}

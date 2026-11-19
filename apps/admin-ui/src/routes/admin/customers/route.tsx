import { createFileRoute, Outlet, useLocation } from '@tanstack/react-router'
import { CustomerList } from '@/screens/customers/customer-list'
import { Page } from '@/components/admin/page'

export const Route = createFileRoute('/admin/customers')({ component: CustomersRoute })

function CustomersRoute() {
  const pathname = useLocation({ select: (location) => location.pathname })
  return pathname === '/admin/customers' ? (
    <Page>
      <CustomerList />
    </Page>
  ) : (
    <Outlet />
  )
}

import { createFileRoute, Outlet, useLocation } from '@tanstack/react-router'
import { ProductList } from '@/screens/products/product-list'
import { Page } from '@/components/admin/page'

export const Route = createFileRoute('/admin/products')({ component: ProductsPage })
function ProductsPage() {
  const pathname = useLocation({ select: (location) => location.pathname })
  const { access } = Route.useRouteContext()
  if (pathname !== '/admin/products') return <Outlet />
  return (
    <Page>
      <ProductList currency={access.tenant?.shop.currency ?? 'USD'} />
    </Page>
  )
}

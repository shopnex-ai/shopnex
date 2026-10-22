import { createFileRoute } from '@tanstack/react-router'
import { ProductDetail } from '@/screens/products/[id]/product-detail'

export const Route = createFileRoute('/admin/products/$id')({ component: ProductPage })
function ProductPage() {
  const { id } = Route.useParams()
  const { access } = Route.useRouteContext()
  return (
    <div className="mx-auto max-w-6xl">
      <ProductDetail id={id} currency={access.tenant?.shop.currency ?? 'USD'} />
    </div>
  )
}

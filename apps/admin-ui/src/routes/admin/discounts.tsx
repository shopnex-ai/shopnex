import { createFileRoute } from '@tanstack/react-router'
import { DiscountList } from '@/screens/discounts/discount-list'

export const Route = createFileRoute('/admin/discounts')({ component: DiscountsPage })
function DiscountsPage() {
  const { access } = Route.useRouteContext()
  return (
    <div className="mx-auto max-w-5xl">
      <DiscountList currency={access.tenant?.shop.currency ?? 'USD'} />
    </div>
  )
}

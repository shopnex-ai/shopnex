import { createFileRoute } from '@tanstack/react-router'
import { DiscountList } from '@/screens/discounts/discount-list'
import { Page } from '@/components/admin/page'

export const Route = createFileRoute('/admin/discounts')({ component: DiscountsPage })
function DiscountsPage() {
  const { access } = Route.useRouteContext()
  return (
    <Page>
      <DiscountList currency={access.tenant?.shop.currency ?? 'USD'} />
    </Page>
  )
}

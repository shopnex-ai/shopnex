import { createFileRoute } from '@tanstack/react-router'
import { GiftCardList } from '@/screens/gift-cards/gift-card-list'
import { Page } from '@/components/admin/page'

export const Route = createFileRoute('/admin/gift-cards')({ component: GiftCardsPage })
function GiftCardsPage() {
  const { access } = Route.useRouteContext()
  return (
    <Page>
      <GiftCardList currency={access.tenant?.shop.currency ?? 'USD'} />
    </Page>
  )
}

import { createFileRoute } from '@tanstack/react-router'
import { PageHeader } from '@/components/admin/page-header'
import { PaymentAppsCard, PaymentMethodsCard } from '@/screens/settings/payment-methods-card'
import { UnpaidOrdersCard } from '@/screens/settings/unpaid-orders-card'

export const Route = createFileRoute('/admin/settings/payments')({ component: PaymentsSettingsPage })
function PaymentsSettingsPage() {
  const tenant = Route.useRouteContext().access.tenant
  return (
    <>
      <PageHeader title="Payments" />
      <PaymentMethodsCard />
      <UnpaidOrdersCard />
      {tenant && <PaymentAppsCard shopId={tenant.shop.id} />}
    </>
  )
}

import type { FinancialStatus, FulfillmentStatus } from '@shopnex/api/schemas'
import { Badge } from '@/components/ui/badge'

// Shopify's labels: payment and fulfillment are shown separately
const financial: Record<FinancialStatus, { label: string; variant: 'default' | 'secondary' | 'outline' }> = {
  pending: { label: 'Payment pending', variant: 'secondary' },
  authorized: { label: 'Authorized', variant: 'secondary' },
  partially_paid: { label: 'Partially paid', variant: 'secondary' },
  paid: { label: 'Paid', variant: 'default' },
  partially_refunded: { label: 'Partially refunded', variant: 'outline' },
  refunded: { label: 'Refunded', variant: 'outline' },
  voided: { label: 'Voided', variant: 'outline' },
}

const fulfillment: Record<FulfillmentStatus, { label: string; variant: 'default' | 'secondary' | 'outline' }> = {
  unfulfilled: { label: 'Unfulfilled', variant: 'secondary' },
  partially_fulfilled: { label: 'Partially fulfilled', variant: 'secondary' },
  fulfilled: { label: 'Fulfilled', variant: 'outline' },
}

export function FinancialStatusBadge({ status }: { status: FinancialStatus }) {
  const { label, variant } = financial[status]
  return <Badge variant={variant}>{label}</Badge>
}

export function FulfillmentStatusBadge({ status }: { status: FulfillmentStatus }) {
  const { label, variant } = fulfillment[status]
  return <Badge variant={variant}>{label}</Badge>
}

/** Payment + fulfillment, or just "Cancelled" */
export function OrderStatusBadges({
  order,
}: {
  order: { financialStatus: FinancialStatus; fulfillmentStatus: FulfillmentStatus; cancelledAt: Date | string | null }
}) {
  return (
    <span className="inline-flex flex-wrap gap-1">
      {order.cancelledAt && <Badge variant="destructive">Cancelled</Badge>}
      <FinancialStatusBadge status={order.financialStatus} />
      {!order.cancelledAt && <FulfillmentStatusBadge status={order.fulfillmentStatus} />}
    </span>
  )
}

import { createFileRoute } from '@tanstack/react-router'
import { InvoicePage } from '@/screens/orders/[id]/invoice'

// A printable invoice for one order, without the admin around it (sign-in still applies: this is under /admin)
export const Route = createFileRoute('/admin/orders/$id_/invoice')({
  staticData: { standalone: true },
  component: InvoiceRoute,
})
function InvoiceRoute() {
  const { id } = Route.useParams()
  return <InvoicePage id={id} />
}

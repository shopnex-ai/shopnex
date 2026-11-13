import { createFileRoute } from '@tanstack/react-router'
import { PrintPage } from '@/screens/orders/print/print-page'

// A printable packing slip for one order, without the admin around it
export const Route = createFileRoute('/admin/orders/$id_/packing-slip')({
  staticData: { standalone: true },
  component: PackingSlipRoute,
})
function PackingSlipRoute() {
  const { id } = Route.useParams()
  return <PrintPage ids={[id]} type="packing-slip" />
}

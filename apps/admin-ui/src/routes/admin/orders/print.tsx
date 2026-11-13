import { createFileRoute } from '@tanstack/react-router'
import { PrintPage, type PrintType } from '@/screens/orders/print/print-page'

// Invoices or packing slips for the orders selected in the list: /admin/orders/print?type=invoice&ids=<id>,<id>
export const Route = createFileRoute('/admin/orders/print')({
  staticData: { standalone: true },
  // `ids` stays the plain comma-separated string it is in the URL: the router validates the search again after the first
  // pass, and a validator that turned it into an array would see that array the second time and lose it
  validateSearch: (search: Record<string, unknown>): { ids: string; type: PrintType } => ({
    ids: typeof search.ids === 'string' ? search.ids : Array.isArray(search.ids) ? search.ids.join(',') : '',
    type: search.type === 'packing-slip' ? 'packing-slip' : 'invoice',
  }),
  component: PrintRoute,
})
function PrintRoute() {
  const { ids, type } = Route.useSearch()
  return <PrintPage ids={[...new Set(ids.split(',').filter(Boolean))]} type={type} />
}

import { PrinterIcon } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { MAX_PRINT_ORDERS, type PrintType } from './print/print-page'

/** "Print" for the orders selected in the list: invoices or packing slips, all in one printable page */
export function PrintSelectedButton({ ids }: { ids: string[] }) {
  const open = (type: PrintType) => {
    if (ids.length > MAX_PRINT_ORDERS) {
      toast.error(`Select up to ${MAX_PRINT_ORDERS} orders to print at a time.`)
      return
    }
    window.open(`/admin/orders/print?type=${type}&ids=${ids.join(',')}`, '_blank', 'noopener')
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="outline" size="sm" />}>
        <PrinterIcon />
        Print
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuItem onClick={() => open('invoice')}>{ids.length === 1 ? 'Invoice' : 'Invoices'}</DropdownMenuItem>
        <DropdownMenuItem onClick={() => open('packing-slip')}>
          {ids.length === 1 ? 'Packing slip' : 'Packing slips'}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { DownloadIcon, ShieldIcon } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { client, orpc } from '@/lib/orpc'

/** A customer's data on request: a copy to hand over, or erased. Shown to owners and admins only. */
export function PrivacyCard({ id, email }: { id: string; email: string }) {
  const [exporting, setExporting] = useState(false)

  const download = async () => {
    setExporting(true)
    try {
      const data = await client.admin.customers.exportData({ id })
      const file = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(file)
      const link = document.createElement('a')
      link.href = url
      // No name or email in the file name: it ends up in a downloads folder
      link.download = `customer-data-${id.slice(0, 8)}.json`
      link.click()
      URL.revokeObjectURL(url)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not export the data')
    } finally {
      setExporting(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShieldIcon className="size-4" />
          Privacy
        </CardTitle>
        <CardDescription>Give this customer a copy of their data, or remove it when they ask.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="max-w-md text-muted-foreground">
            Everything held about them as one JSON file: the record, login, orders, carts and emails sent.
          </p>
          <Button variant="outline" disabled={exporting} onClick={download}>
            <DownloadIcon />
            {exporting ? 'Preparing…' : 'Export data'}
          </Button>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
          <p className="max-w-md text-muted-foreground">
            Removes their name, email, phone and addresses. Orders stay as accounting records, without the buyer.
          </p>
          <EraseDialog id={id} email={email} />
        </div>
      </CardContent>
    </Card>
  )
}

function EraseDialog({ id, email }: { id: string; email: string }) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [typed, setTyped] = useState('')
  const [error, setError] = useState<string | null>(null)
  const erase = useMutation(orpc.admin.customers.erase.mutationOptions())
  const confirmed = typed.trim().toLowerCase() === email.toLowerCase()

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        setTyped('')
        setError(null)
      }}
    >
      <DialogTrigger render={<Button variant="destructive" />}>Erase personal data</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Erase the personal data of {email}?</DialogTitle>
          <DialogDescription>This can&apos;t be undone.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <p>
            <span className="font-medium">Removed:</span> their name, email and phone; the name, email, phone and
            addresses on their orders, and order notes; their carts; the emails stored for them; webhook history that
            mentions them; and their storefront login.
          </p>
          <p>
            <span className="font-medium">Kept:</span> their orders, as accounting records: number, date, items, totals,
            tax, payments and the delivery country. Invoices for these orders will no longer show the buyer. If tax law
            requires you to keep them, print or export them first.
          </p>
          <p className="text-muted-foreground">
            Not touched: values in custom fields on orders, the unsubscribe list, and data held by apps (they are told
            through the <code>customer.erased</code> webhook).
          </p>
        </div>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="erase-confirm">Type {email} to confirm</FieldLabel>
            <Input
              id="erase-confirm"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              autoComplete="off"
              aria-invalid={error ? true : undefined}
            />
            {error && <p className="text-sm text-destructive">{error}</p>}
          </Field>
        </FieldGroup>
        <DialogFooter>
          <DialogClose render={<Button variant="ghost" />}>Keep customer</DialogClose>
          <Button
            variant="destructive"
            disabled={!confirmed || erase.isPending}
            onClick={async () => {
              setError(null)
              try {
                await erase.mutateAsync({ id })
                toast.success('Personal data erased')
                setOpen(false)
                // Leave first: this customer no longer exists, so refreshing its page would only fail and retry
                await navigate({ to: '/admin/customers' })
                queryClient.removeQueries({ queryKey: orpc.admin.customers.get.key({ input: { id } }) })
                void queryClient.invalidateQueries({ queryKey: orpc.admin.customers.key() })
                void queryClient.invalidateQueries({ queryKey: orpc.admin.orders.key() })
              } catch (e) {
                setError(e instanceof Error ? e.message : 'Could not erase the data')
              }
            }}
          >
            {erase.isPending ? 'Erasing…' : 'Erase personal data'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

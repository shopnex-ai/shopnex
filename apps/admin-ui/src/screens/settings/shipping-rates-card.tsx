'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { PlusIcon } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { shippingRateInput } from '@shopnex/api/schemas'
import { DataTable, columnHelper } from '@/components/admin/data-table'
import { CheckboxField, FormError, MoneyField, TextField, setServerError, useZodForm } from '@/components/admin/form'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Field, FieldGroup } from '@/components/ui/field'
import { formatMoney } from '@/lib/money'
import { orpc, type Outputs } from '@/lib/orpc'

type Rate = Outputs['admin']['shippingRates']['list'][number]

export function ShippingRatesCard({ currency }: { currency: string }) {
  const { data, error, isPending } = useQuery(orpc.admin.shippingRates.list.queryOptions())
  const money = (cents: number) => formatMoney(cents, currency)

  const col = columnHelper<Rate>()
  const columns = [
    col.accessor('name', {
      header: 'Name',
      cell: ({ row: { original: r } }) => (
        <span className="flex items-center gap-2">
          {r.name}
          {!r.active && <Badge variant="outline">Inactive</Badge>}
        </span>
      ),
    }),
    col.accessor('priceCents', {
      header: 'Price',
      cell: ({ row: { original: r } }) =>
        r.priceCents === 0
          ? 'Free'
          : `${money(r.priceCents)}${r.freeAboveCents != null ? ` · free from ${money(r.freeAboveCents)}` : ''}`,
      meta: { className: 'tabular-nums' },
    }),
    col.display({
      id: 'actions',
      cell: ({ row: { original: r } }) => <RateDialog rate={r} currency={currency} />,
      meta: { className: 'text-right' },
    }),
  ]

  return (
    <Card>
      <CardHeader>
        <CardTitle>Shipping</CardTitle>
        <CardDescription>
          Rates buyers choose from at checkout, for every address. Without any, orders ship free.
        </CardDescription>
        <CardAction>
          <RateDialog currency={currency} />
        </CardAction>
      </CardHeader>
      <CardContent>
        <DataTable
          columns={columns}
          data={data}
          getRowId={(r) => r.id}
          isPending={isPending}
          error={error}
          empty="No shipping rates — checkout charges no shipping."
        />
      </CardContent>
    </Card>
  )
}

const empty = { name: '', priceCents: 0, freeAboveCents: null, active: true }

// Create when `rate` is omitted, otherwise edit (or delete) it
function RateDialog({ rate, currency }: { rate?: Rate; currency: string }) {
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const toValues = () =>
    rate
      ? { name: rate.name, priceCents: rate.priceCents, freeAboveCents: rate.freeAboveCents, active: rate.active }
      : empty
  const form = useZodForm(shippingRateInput, { defaultValues: toValues() })
  const create = useMutation(orpc.admin.shippingRates.create.mutationOptions())
  const update = useMutation(orpc.admin.shippingRates.update.mutationOptions())
  const remove = useMutation(orpc.admin.shippingRates.delete.mutationOptions())
  const refresh = () => queryClient.invalidateQueries({ queryKey: orpc.admin.shippingRates.key() })

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      if (rate) await update.mutateAsync({ id: rate.id, ...values })
      else await create.mutateAsync(values)
      await refresh()
      toast.success(rate ? 'Rate saved' : 'Rate added')
      setOpen(false)
    } catch (error) {
      setServerError(form, error)
    }
  })

  async function onDelete() {
    try {
      await remove.mutateAsync({ id: rate!.id })
      await refresh()
      toast.success('Rate deleted')
      setOpen(false)
    } catch (error) {
      setServerError(form, error)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (next) form.reset(toValues())
      }}
    >
      <DialogTrigger render={<Button variant={rate ? 'ghost' : 'outline'} size="sm" />}>
        {rate ? (
          'Edit'
        ) : (
          <>
            <PlusIcon />
            Add rate
          </>
        )}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{rate ? 'Edit shipping rate' : 'Add shipping rate'}</DialogTitle>
          <DialogDescription>Buyers see the name and price at checkout.</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} noValidate>
          <FieldGroup>
            <TextField
              control={form.control}
              name="name"
              label="Name"
              placeholder="Standard shipping"
              autoComplete="off"
            />
            <MoneyField
              control={form.control}
              name="priceCents"
              label="Price"
              currency={currency}
              description="0 for free shipping."
            />
            <MoneyField
              control={form.control}
              name="freeAboveCents"
              label="Free from (optional)"
              currency={currency}
              nullable
              description="Orders with at least this subtotal ship free."
            />
            <CheckboxField control={form.control} name="active" label="Offer at checkout" />
            <FormError form={form} />
            <Field orientation="horizontal" className="justify-between">
              {rate ? (
                <Button type="button" variant="ghost" onClick={onDelete} disabled={remove.isPending}>
                  Delete
                </Button>
              ) : (
                <span />
              )}
              <Button type="submit" disabled={form.formState.isSubmitting}>
                {form.formState.isSubmitting ? 'Saving…' : rate ? 'Save' : 'Add rate'}
              </Button>
            </Field>
          </FieldGroup>
        </form>
      </DialogContent>
    </Dialog>
  )
}

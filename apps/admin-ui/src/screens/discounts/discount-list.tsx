'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { PlusIcon } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { discountCreateInput, type DiscountType } from '@shopnex/api/schemas'
import { describeDiscount } from '@shopnex/pricing/calculate'
import { DataTable, columnHelper } from '@/components/admin/data-table'
import {
  CheckboxField,
  DateTimeField,
  FormError,
  IntegerField,
  MoneyField,
  SelectField,
  TextField,
  setServerError,
  useZodForm,
} from '@/components/admin/form'
import { PageHeader } from '@/components/admin/page-header'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Field, FieldGroup } from '@/components/ui/field'
import { formatDate } from '@/lib/format'
import { formatMoney } from '@/lib/money'
import { useOpenOnNew } from '@/hooks/use-open-on-new'
import { orpc, type Outputs } from '@/lib/orpc'
import { client } from '@/lib/orpc'
import { ImportDiscountsDialog } from './import-discounts'
import { ExportDiscountsDialog } from './export-discounts'
import { DeleteSelectedButton } from '@/components/admin/delete-selected-button'

type Discount = Outputs['admin']['discounts']['list'][number]

const typeOptions: { value: DiscountType; label: string }[] = [
  { value: 'percentage', label: 'Percentage off the order' },
  { value: 'fixed_amount', label: 'Fixed amount off the order' },
  { value: 'free_shipping', label: 'Free shipping' },
]

// Shopify-style status, derived from the switch, the dates and usage
function status(d: Discount): { label: string; variant: 'default' | 'secondary' | 'outline' } {
  const now = new Date()
  if (!d.active) return { label: 'Inactive', variant: 'outline' }
  if (d.endsAt && new Date(d.endsAt) <= now) return { label: 'Expired', variant: 'outline' }
  if (d.usageLimit != null && d.usageCount >= d.usageLimit) return { label: 'Used up', variant: 'outline' }
  if (d.startsAt && new Date(d.startsAt) > now) return { label: 'Scheduled', variant: 'secondary' }
  return { label: 'Active', variant: 'default' }
}

export function DiscountList({ currency }: { currency: string }) {
  const queryClient = useQueryClient()
  const { data, error, isPending } = useQuery(orpc.admin.discounts.list.queryOptions())
  const money = (cents: number) => formatMoney(cents, currency)

  const col = columnHelper<Discount>()
  const columns = [
    col.accessor('code', {
      header: 'Code',
      cell: ({ row: { original: d } }) => {
        const s = status(d)
        return (
          <span className="flex items-center gap-2">
            <span className="font-mono font-medium">{d.code}</span>
            <Badge variant={s.variant}>{s.label}</Badge>
          </span>
        )
      },
    }),
    col.display({
      id: 'summary',
      header: 'Discount',
      cell: ({ row: { original: d } }) =>
        [
          describeDiscount(d, money),
          d.minSubtotalCents != null && `orders from ${money(d.minSubtotalCents)}`,
          d.oncePerCustomer && 'once per customer',
          d.endsAt && `until ${formatDate(d.endsAt)}`,
        ]
          .filter(Boolean)
          .join(' · '),
    }),
    col.accessor('usageCount', {
      header: 'Used',
      cell: ({ row: { original: d } }) => (d.usageLimit != null ? `${d.usageCount} / ${d.usageLimit}` : d.usageCount),
      meta: { className: 'text-right tabular-nums' },
    }),
    col.display({
      id: 'actions',
      cell: ({ row: { original: d } }) => <DiscountDialog discount={d} currency={currency} />,
      meta: { className: 'text-right' },
    }),
  ]

  return (
    <div className="space-y-4">
      <PageHeader
        title="Discounts"
        description="Codes buyers enter at checkout. One code per order."
        actions={
          <div className="flex gap-2">
            <ImportDiscountsDialog currency={currency} />
            <ExportDiscountsDialog />
            <DiscountDialog currency={currency} />
          </div>
        }
      />
      <Card>
        <CardContent>
          <DataTable
            columns={columns}
            data={data}
            getRowId={(d) => d.id}
            isPending={isPending}
            error={error}
            empty="No discounts yet."
            selectionActions={(ids, clearSelection) => (
              <DeleteSelectedButton
                ids={ids}
                entity={ids.length === 1 ? 'discount' : 'discounts'}
                remove={(selected) => client.admin.discounts.deleteMany({ ids: selected })}
                onDeleted={async () => {
                  clearSelection()
                  await queryClient.invalidateQueries({ queryKey: orpc.admin.discounts.key() })
                }}
              />
            )}
          />
        </CardContent>
      </Card>
    </div>
  )
}

const empty = {
  code: '',
  type: 'percentage' as DiscountType,
  value: 10,
  minSubtotalCents: null,
  usageLimit: null,
  oncePerCustomer: false,
  active: true,
  startsAt: null,
  endsAt: null,
}

// Create when `discount` is omitted, otherwise edit (or delete) it
function DiscountDialog({ discount, currency }: { discount?: Discount; currency: string }) {
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  // Only the create dialog; the empty form needs no reset on open
  useOpenOnNew(() => setOpen(true), !discount)
  const toValues = () =>
    discount
      ? {
          code: discount.code,
          type: discount.type,
          value: discount.value,
          minSubtotalCents: discount.minSubtotalCents,
          usageLimit: discount.usageLimit,
          oncePerCustomer: discount.oncePerCustomer,
          active: discount.active,
          startsAt: discount.startsAt,
          endsAt: discount.endsAt,
        }
      : empty
  const form = useZodForm(discountCreateInput, { defaultValues: toValues() })
  const create = useMutation(orpc.admin.discounts.create.mutationOptions())
  const update = useMutation(orpc.admin.discounts.update.mutationOptions())
  const remove = useMutation(orpc.admin.discounts.delete.mutationOptions())
  const refresh = () => queryClient.invalidateQueries({ queryKey: orpc.admin.discounts.key() })

  // The value means something else for each type: start over when the type changes
  const type = form.watch('type')
  const previousType = useRef(type)
  useEffect(() => {
    if (previousType.current === type) return
    previousType.current = type
    form.setValue('value', type === 'free_shipping' ? 0 : (undefined as unknown as number))
  }, [type, form])

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      if (discount) await update.mutateAsync({ id: discount.id, ...values })
      else await create.mutateAsync(values)
      await refresh()
      toast.success(discount ? 'Discount saved' : 'Discount created')
      setOpen(false)
    } catch (error) {
      setServerError(form, error, { CONFLICT: 'code' })
    }
  })

  async function onDelete() {
    try {
      await remove.mutateAsync({ id: discount!.id })
      await refresh()
      toast.success('Discount deleted')
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
        if (next) {
          form.reset(toValues())
          previousType.current = toValues().type
        }
      }}
    >
      <DialogTrigger render={<Button variant={discount ? 'ghost' : 'default'} size="sm" />}>
        {discount ? (
          'Edit'
        ) : (
          <>
            <PlusIcon />
            Create discount
          </>
        )}
      </DialogTrigger>
      <DialogContent className="max-h-[90svh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{discount ? 'Edit discount' : 'Create discount'}</DialogTitle>
          <DialogDescription>
            {discount && discount.usageCount > 0
              ? `Used ${discount.usageCount} time${discount.usageCount === 1 ? '' : 's'}. Orders already placed keep their discount.`
              : 'Buyers enter the code at checkout.'}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} noValidate>
          <FieldGroup>
            <TextField
              control={form.control}
              name="code"
              label="Code"
              placeholder="SUMMER20"
              autoComplete="off"
              description="Not case-sensitive."
            />
            <SelectField control={form.control} name="type" label="Type" options={typeOptions} />
            {type === 'percentage' && (
              <IntegerField control={form.control} name="value" label="Percentage" min={1} placeholder="10" />
            )}
            {type === 'fixed_amount' && (
              <MoneyField control={form.control} name="value" label="Amount" currency={currency} />
            )}
            <MoneyField
              control={form.control}
              name="minSubtotalCents"
              label="Minimum subtotal (optional)"
              currency={currency}
              nullable
            />
            <IntegerField
              control={form.control}
              name="usageLimit"
              label="Total usage limit (optional)"
              min={1}
              nullable
              description="How many orders can use this code in total."
            />
            <CheckboxField control={form.control} name="oncePerCustomer" label="Limit to one use per customer" />
            <div className="grid gap-4 sm:grid-cols-2">
              <DateTimeField control={form.control} name="startsAt" label="Starts (optional)" />
              <DateTimeField control={form.control} name="endsAt" label="Ends (optional)" />
            </div>
            <CheckboxField control={form.control} name="active" label="Active" />
            <FormError form={form} />
            <Field orientation="horizontal" className="justify-between">
              {discount ? (
                <Button type="button" variant="ghost" onClick={onDelete} disabled={remove.isPending}>
                  Delete
                </Button>
              ) : (
                <span />
              )}
              <Button type="submit" disabled={form.formState.isSubmitting}>
                {form.formState.isSubmitting ? 'Saving…' : discount ? 'Save' : 'Create discount'}
              </Button>
            </Field>
          </FieldGroup>
        </form>
      </DialogContent>
    </Dialog>
  )
}

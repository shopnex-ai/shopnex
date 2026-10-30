'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { PlusIcon } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { shopInput, taxRateInput } from '@shopnex/api/schemas'
import { DataTable, columnHelper } from '@/components/admin/data-table'
import { DialogDeleteButton } from '@/components/admin/dialog-delete-button'
import {
  CheckboxField,
  FormError,
  NumberField,
  SelectField,
  TextField,
  setServerError,
  useZodForm,
} from '@/components/admin/form'
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
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { countryName, countryOptions } from '@/lib/countries'
import { orpc, type Outputs } from '@/lib/orpc'

type Rate = Outputs['admin']['taxRates']['list'][number]
type Shop = Outputs['admin']['shop']['get']

export function TaxesCard() {
  const { data, error, isPending } = useQuery(orpc.admin.taxRates.list.queryOptions())
  const shop = useQuery(orpc.admin.shop.get.queryOptions())

  const col = columnHelper<Rate>()
  const columns = [
    col.accessor('countryCode', {
      header: 'Region',
      cell: ({ row: { original: r } }) =>
        r.province ? `${r.province}, ${countryName(r.countryCode)}` : countryName(r.countryCode),
    }),
    col.accessor('name', { header: 'Name' }),
    col.accessor('ratePercent', {
      header: 'Rate',
      cell: (c) => `${c.getValue()}%`,
      meta: { className: 'text-right tabular-nums' },
    }),
    col.display({
      id: 'actions',
      cell: ({ row: { original: r } }) => <RateDialog rate={r} />,
      meta: { className: 'text-right' },
    }),
  ]

  return (
    <Card>
      <CardHeader>
        <CardTitle>Taxes</CardTitle>
        <CardDescription>
          Charged by the shipping address. A state or province rate replaces the country rate. Without a rate for the
          address, no tax is charged.
        </CardDescription>
        <CardAction>
          <RateDialog />
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-6">
        <DataTable
          columns={columns}
          data={data}
          getRowId={(r) => r.id}
          isPending={isPending}
          error={error}
          empty="No tax rates — checkout charges no tax."
        />
        <Separator />
        {shop.data ? (
          <TaxSettingsForm key={shop.data.id} shop={shop.data} />
        ) : shop.error ? (
          <p className="text-sm text-destructive">{shop.error.message}</p>
        ) : (
          <Skeleton className="h-20 w-full" />
        )}
      </CardContent>
    </Card>
  )
}

const settingsInput = shopInput.pick({ taxesIncluded: true, taxShipping: true })
const toSettings = (shop: Shop) => ({ taxesIncluded: shop.taxesIncluded, taxShipping: shop.taxShipping })

function TaxSettingsForm({ shop }: { shop: Shop }) {
  const queryClient = useQueryClient()
  const form = useZodForm(settingsInput, { defaultValues: toSettings(shop) })
  const update = useMutation(orpc.admin.shop.update.mutationOptions())

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      const saved = await update.mutateAsync(values)
      queryClient.setQueryData(orpc.admin.shop.get.queryKey(), saved)
      form.reset(toSettings(saved))
      toast.success('Tax settings saved')
    } catch (error) {
      setServerError(form, error)
    }
  })

  const { isSubmitting, isDirty } = form.formState
  return (
    <form onSubmit={onSubmit} noValidate>
      <FieldGroup>
        <CheckboxField
          control={form.control}
          name="taxesIncluded"
          label="All prices include tax"
          description="Common in the EU and UK: the tax is part of the price, so checkout shows it but doesn't add it."
        />
        <CheckboxField control={form.control} name="taxShipping" label="Charge tax on shipping" />
        <FormError form={form} />
        <Field orientation="horizontal" className="justify-end">
          <Button type="submit" variant="outline" disabled={isSubmitting || !isDirty}>
            {isSubmitting ? 'Saving…' : 'Save'}
          </Button>
        </Field>
      </FieldGroup>
    </form>
  )
}

const empty = { countryCode: '', province: null, name: '', ratePercent: undefined as unknown as number }

// Create when `rate` is omitted, otherwise edit (or delete) it
function RateDialog({ rate }: { rate?: Rate }) {
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const toValues = () =>
    rate
      ? { countryCode: rate.countryCode, province: rate.province, name: rate.name, ratePercent: rate.ratePercent }
      : empty
  const form = useZodForm(taxRateInput, { defaultValues: toValues() })
  const create = useMutation(orpc.admin.taxRates.create.mutationOptions())
  const update = useMutation(orpc.admin.taxRates.update.mutationOptions())
  const remove = useMutation(orpc.admin.taxRates.delete.mutationOptions())
  const refresh = () => queryClient.invalidateQueries({ queryKey: orpc.admin.taxRates.key() })

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      if (rate) await update.mutateAsync({ id: rate.id, ...values })
      else await create.mutateAsync(values)
      await refresh()
      toast.success(rate ? 'Tax rate saved' : 'Tax rate added')
      setOpen(false)
    } catch (error) {
      setServerError(form, error, { CONFLICT: 'province' })
    }
  })

  async function onDelete() {
    try {
      await remove.mutateAsync({ id: rate!.id })
      await refresh()
      toast.success('Tax rate deleted')
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
          <DialogTitle>{rate ? 'Edit tax rate' : 'Add tax rate'}</DialogTitle>
          <DialogDescription>Buyers see the name and amount at checkout.</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} noValidate>
          <FieldGroup>
            <SelectField control={form.control} name="countryCode" label="Country / region" options={countryOptions} />
            <TextField
              control={form.control}
              name="province"
              label="State / province (optional)"
              nullable
              autoComplete="off"
              description="Leave empty for the whole country. Matched against the address buyers type, e.g. “California”."
            />
            <TextField control={form.control} name="name" label="Name" placeholder="VAT" autoComplete="off" />
            <NumberField
              control={form.control}
              name="ratePercent"
              label="Rate (%)"
              min={0}
              max={100}
              placeholder="20"
            />
            <FormError form={form} />
            <Field orientation="horizontal" className="justify-between">
              {rate ? <DialogDeleteButton onDelete={onDelete} pending={remove.isPending} /> : <span />}
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

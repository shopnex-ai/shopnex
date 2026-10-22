'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { toast } from 'sonner'
import { variantInput } from '@shopnex/api/schemas'
import { DataTable, columnHelper } from '@/components/admin/data-table'
import { FormError, IntegerField, MoneyField, TextField, setServerError, useZodForm } from '@/components/admin/form'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Field, FieldGroup } from '@/components/ui/field'
import { formatMoney } from '@/lib/money'
import { orpc } from '@/lib/orpc'
import type { Product } from './product-detail'

type Variant = Product['variants'][number]

const variantForm = variantInput.pick({
  priceCents: true,
  compareAtPriceCents: true,
  sku: true,
  inventoryQuantity: true,
})

// A product without options has one hidden default variant: show it as "Pricing & inventory"
const isDefaultOnly = (p: Product) => p.options.length === 0

export function VariantsCard({ product, currency }: { product: Product; currency: string }) {
  const [editing, setEditing] = useState<Variant | null>(null)
  const money = (cents: number | null) => (cents == null ? '—' : formatMoney(cents, currency))

  const col = columnHelper<Variant>()
  const columns = [
    ...(isDefaultOnly(product) ? [] : [col.accessor('title', { header: 'Variant' })]),
    col.accessor('priceCents', {
      header: 'Price',
      cell: (c) => money(c.getValue()),
      meta: { className: 'tabular-nums' },
    }),
    col.accessor('compareAtPriceCents', {
      header: 'Compare-at',
      cell: (c) => <span className="text-muted-foreground">{money(c.getValue())}</span>,
      meta: { className: 'tabular-nums' },
    }),
    col.accessor('sku', { header: 'SKU', cell: (c) => c.getValue() ?? '—' }),
    col.accessor('inventoryQuantity', {
      header: 'Available',
      cell: (c) => {
        const qty = c.getValue()
        if (qty == null) return <span className="text-muted-foreground">Not tracked</span>
        return <span className={qty <= 0 ? 'text-destructive' : undefined}>{qty}</span>
      },
      meta: { className: 'text-right tabular-nums' },
    }),
    col.display({
      id: 'edit',
      header: () => <span className="sr-only">Edit</span>,
      cell: ({ row }) => (
        <Button variant="ghost" size="sm" onClick={() => setEditing(row.original)}>
          Edit
        </Button>
      ),
      meta: { className: 'w-0 text-right' },
    }),
  ]

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {isDefaultOnly(product) ? 'Pricing & inventory' : `Variants (${product.variants.length})`}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <DataTable columns={columns} data={product.variants} getRowId={(v) => v.id} empty="No variants." />
      </CardContent>
      <Dialog open={!!editing} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent>
          {editing && (
            <>
              <DialogHeader>
                <DialogTitle>{isDefaultOnly(product) ? 'Pricing & inventory' : editing.title}</DialogTitle>
                <DialogDescription>{product.title}</DialogDescription>
              </DialogHeader>
              <VariantForm
                key={editing.id}
                productId={product.id}
                variant={editing}
                currency={currency}
                onSaved={() => setEditing(null)}
              />
            </>
          )}
        </DialogContent>
      </Dialog>
    </Card>
  )
}

function VariantForm({
  productId,
  variant,
  currency,
  onSaved,
}: {
  productId: string
  variant: Variant
  currency: string
  onSaved: () => void
}) {
  const queryClient = useQueryClient()
  const form = useZodForm(variantForm, {
    defaultValues: {
      priceCents: variant.priceCents,
      compareAtPriceCents: variant.compareAtPriceCents,
      sku: variant.sku,
      inventoryQuantity: variant.inventoryQuantity,
    },
  })
  const update = useMutation(orpc.admin.products.updateVariant.mutationOptions())

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      await update.mutateAsync({ variantId: variant.id, ...values })
      // Price changes also move the product's price range: refresh the product and the list
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: orpc.admin.products.get.queryKey({ input: { id: productId } }) }),
        queryClient.invalidateQueries({ queryKey: orpc.admin.products.list.key() }),
      ])
      toast.success('Variant saved')
      onSaved()
    } catch (error) {
      setServerError(form, error, { CONFLICT: 'sku' })
    }
  })

  const { isSubmitting, isDirty } = form.formState

  return (
    <form onSubmit={onSubmit} noValidate>
      <FieldGroup>
        <div className="grid grid-cols-2 gap-4">
          <MoneyField control={form.control} name="priceCents" label="Price" currency={currency} />
          <MoneyField
            control={form.control}
            name="compareAtPriceCents"
            label="Compare-at price"
            currency={currency}
            nullable
          />
        </div>
        <TextField control={form.control} name="sku" label="SKU" nullable autoComplete="off" />
        <IntegerField
          control={form.control}
          name="inventoryQuantity"
          label="Available"
          nullable
          min={0}
          placeholder="Not tracked"
          description="Leave empty to sell without tracking stock."
        />
        <FormError form={form} />
        <Field orientation="horizontal" className="justify-end">
          <Button type="submit" disabled={isSubmitting || !isDirty}>
            {isSubmitting ? 'Saving…' : 'Save'}
          </Button>
        </Field>
      </FieldGroup>
    </form>
  )
}

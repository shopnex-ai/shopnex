'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { PlusIcon } from 'lucide-react'
import { useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { toast } from 'sonner'
import { productFields } from '@shopnex/api/schemas'
import { FormError, MoneyField, SelectField, TextField, setServerError, useZodForm } from '@/components/admin/form'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Field, FieldGroup } from '@/components/ui/field'
import { useOpenOnNew } from '@/hooks/use-open-on-new'
import { orpc } from '@/lib/orpc'

// The essentials; images, description, variants and stock are edited on the product page
const newProduct = productFields.pick({ title: true, status: true }).extend({
  priceCents: productFields.shape.priceCents.unwrap(),
})

const statusOptions = [
  { value: 'active', label: 'Active — visible on the storefront' },
  { value: 'draft', label: 'Draft — hidden until you publish it' },
] as const

export function NewProductButton({ currency }: { currency: string }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  useOpenOnNew(() => setOpen(true))
  const form = useZodForm(newProduct, { defaultValues: { title: '', status: 'active', priceCents: undefined } })
  const create = useMutation(orpc.admin.products.create.mutationOptions())

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      const product = await create.mutateAsync({
        ...values,
        descriptionHtml: null,
        vendor: '',
        productType: '',
        tags: [],
      })
      await queryClient.invalidateQueries({ queryKey: orpc.admin.products.key() })
      toast.success('Product created')
      setOpen(false)
      navigate({ to: '/admin/products/$id', params: { id: product.id } })
    } catch (error) {
      setServerError(form, error, { CONFLICT: 'title' })
    }
  })

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) form.reset()
      }}
    >
      <DialogTrigger render={<Button />}>
        <PlusIcon />
        New product
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New product</DialogTitle>
          <DialogDescription>Add images, a description, variants and stock on the next page.</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} noValidate>
          <FieldGroup>
            <TextField control={form.control} name="title" label="Title" autoComplete="off" />
            <MoneyField control={form.control} name="priceCents" label="Price" currency={currency} />
            <SelectField control={form.control} name="status" label="Status" options={statusOptions} />
            <FormError form={form} />
            <Field orientation="horizontal" className="justify-end">
              <Button type="submit" disabled={form.formState.isSubmitting}>
                {form.formState.isSubmitting ? 'Creating…' : 'Create product'}
              </Button>
            </Field>
          </FieldGroup>
        </form>
      </DialogContent>
    </Dialog>
  )
}

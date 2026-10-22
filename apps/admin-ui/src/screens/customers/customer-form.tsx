'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { customerInput } from '@shopnex/api/schemas'
import { FormError, TextField, setServerError, useZodForm } from '@/components/admin/form'
import { Button } from '@/components/ui/button'
import { Field, FieldGroup } from '@/components/ui/field'
import { orpc, type Outputs } from '@/lib/orpc'

type Customer = Outputs['admin']['customers']['get']

const toValues = (c?: Customer) => ({ email: c?.email ?? '', name: c?.name ?? null, phone: c?.phone ?? null })

// Create when `customer` is omitted, otherwise edit it
export function CustomerForm({ customer, onSaved }: { customer?: Customer; onSaved?: (customer: Customer) => void }) {
  const queryClient = useQueryClient()
  const form = useZodForm(customerInput, { defaultValues: toValues(customer) })
  const create = useMutation(orpc.admin.customers.create.mutationOptions())
  const update = useMutation(orpc.admin.customers.update.mutationOptions())

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      const saved = customer
        ? await update.mutateAsync({ id: customer.id, ...values })
        : await create.mutateAsync(values)
      await queryClient.invalidateQueries({ queryKey: orpc.admin.customers.key() })
      form.reset(toValues(saved))
      toast.success(customer ? 'Customer saved' : 'Customer created')
      onSaved?.(saved)
    } catch (error) {
      setServerError(form, error, { CONFLICT: 'email' })
    }
  })

  const { isSubmitting, isDirty } = form.formState

  return (
    <form onSubmit={onSubmit} noValidate>
      <FieldGroup>
        <TextField control={form.control} name="email" label="Email" type="email" autoComplete="off" />
        <TextField control={form.control} name="name" label="Name" nullable autoComplete="off" />
        <TextField control={form.control} name="phone" label="Phone" type="tel" nullable autoComplete="off" />
        <FormError form={form} />
        <Field orientation="horizontal" className="justify-end">
          {customer && isDirty && (
            <Button type="button" variant="ghost" onClick={() => form.reset()}>
              Discard
            </Button>
          )}
          <Button type="submit" disabled={isSubmitting || (customer && !isDirty)}>
            {isSubmitting ? 'Saving…' : customer ? 'Save' : 'Create customer'}
          </Button>
        </Field>
      </FieldGroup>
    </form>
  )
}

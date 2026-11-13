'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { shopInput } from '@shopnex/api/schemas'
import { FormError, TextField, TextareaField, setServerError, useZodForm } from '@/components/admin/form'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, FieldGroup } from '@/components/ui/field'
import { Skeleton } from '@/components/ui/skeleton'
import { orpc, type Outputs } from '@/lib/orpc'

type Shop = Outputs['admin']['shop']['get']

const detailsInput = shopInput.pick({ legalName: true, businessAddress: true, taxId: true })
const toDetails = (shop: Shop) => ({
  legalName: shop.legalName,
  businessAddress: shop.businessAddress,
  taxId: shop.taxId,
})

export function BusinessDetailsCard() {
  const shop = useQuery(orpc.admin.shop.get.queryOptions())
  return (
    <Card>
      <CardHeader>
        <CardTitle>Business details</CardTitle>
        <CardDescription>
          Printed on your invoices. An invoice in the EU has to show who issues it: the business name, its address and
          its VAT number.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {shop.data ? (
          <BusinessDetailsForm key={shop.data.id} shop={shop.data} />
        ) : shop.error ? (
          <p className="text-sm text-destructive">{shop.error.message}</p>
        ) : (
          <Skeleton className="h-40 w-full" />
        )}
      </CardContent>
    </Card>
  )
}

function BusinessDetailsForm({ shop }: { shop: Shop }) {
  const queryClient = useQueryClient()
  const form = useZodForm(detailsInput, { defaultValues: toDetails(shop) })
  const update = useMutation(orpc.admin.shop.update.mutationOptions())

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      const saved = await update.mutateAsync(values)
      queryClient.setQueryData(orpc.admin.shop.get.queryKey(), saved)
      form.reset(toDetails(saved))
      toast.success('Business details saved')
    } catch (error) {
      setServerError(form, error)
    }
  })

  const { isSubmitting, isDirty } = form.formState
  return (
    <form onSubmit={onSubmit} noValidate>
      <FieldGroup>
        <TextField
          control={form.control}
          name="legalName"
          label="Legal business name"
          nullable
          placeholder={shop.name}
          description="Leave empty to use the shop name."
          autoComplete="off"
        />
        <TextareaField
          control={form.control}
          name="businessAddress"
          label="Business address"
          nullable
          rows={4}
          placeholder={'Example Street 1\n10115 Berlin\nGermany'}
          description="One line per row, as it should appear on the invoice."
        />
        <TextField
          control={form.control}
          name="taxId"
          label="VAT or tax number"
          nullable
          placeholder="DE123456789"
          description="Leave empty if you are not registered for VAT."
          autoComplete="off"
        />
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

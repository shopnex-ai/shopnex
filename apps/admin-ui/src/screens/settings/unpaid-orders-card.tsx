'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { shopInput } from '@shopnex/api/schemas'
import { FormError, NumberField, setServerError, useZodForm } from '@/components/admin/form'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, FieldGroup } from '@/components/ui/field'
import { Skeleton } from '@/components/ui/skeleton'
import { orpc, type Outputs } from '@/lib/orpc'

type Shop = Outputs['admin']['shop']['get']

export function UnpaidOrdersCard() {
  const shop = useQuery(orpc.admin.shop.get.queryOptions())
  return (
    <Card>
      <CardHeader>
        <CardTitle>Unpaid orders</CardTitle>
        <CardDescription>
          Orders placed without paying online, such as a bank transfer, keep their stock reserved until you cancel them.
          Set a time limit to cancel them automatically and put the stock back on sale.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {shop.data ? (
          <UnpaidOrdersForm key={shop.data.id} shop={shop.data} />
        ) : shop.error ? (
          <p className="text-sm text-destructive">{shop.error.message}</p>
        ) : (
          <Skeleton className="h-20 w-full" />
        )}
      </CardContent>
    </Card>
  )
}

const settingsInput = shopInput.pick({ unpaidOrderExpiryHours: true })
const toSettings = (shop: Shop) => ({ unpaidOrderExpiryHours: shop.unpaidOrderExpiryHours })

function UnpaidOrdersForm({ shop }: { shop: Shop }) {
  const queryClient = useQueryClient()
  const form = useZodForm(settingsInput, { defaultValues: toSettings(shop) })
  const update = useMutation(orpc.admin.shop.update.mutationOptions())

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      const saved = await update.mutateAsync(values)
      queryClient.setQueryData(orpc.admin.shop.get.queryKey(), saved)
      form.reset(toSettings(saved))
      toast.success('Unpaid order settings saved')
    } catch (error) {
      setServerError(form, error)
    }
  })

  const { isSubmitting, isDirty } = form.formState
  return (
    <form onSubmit={onSubmit} noValidate>
      <FieldGroup>
        <NumberField
          control={form.control}
          name="unpaidOrderExpiryHours"
          label="Cancel unpaid orders after (hours)"
          nullable
          step={1}
          min={1}
          placeholder="Never"
          description="Leave empty to cancel them yourself. Only orders with no payment in progress and nothing shipped are cancelled."
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

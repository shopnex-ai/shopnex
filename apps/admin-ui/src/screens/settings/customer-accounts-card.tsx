import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { shopInput } from '@shopnex/tenancy/contract'
import { CheckboxField, FormError, setServerError, useZodForm } from '@/components/admin/form'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, FieldGroup } from '@/components/ui/field'
import { Skeleton } from '@/components/ui/skeleton'
import { orpc, type Outputs } from '@/lib/orpc'

type Shop = Outputs['admin']['shop']['get']

const accountsInput = shopInput.pick({ customerAccounts: true })
const toAccounts = (shop: Shop) => ({ customerAccounts: shop.customerAccounts })

export function CustomerAccountsCard() {
  const shop = useQuery(orpc.admin.shop.get.queryOptions())
  return (
    <Card>
      <CardHeader>
        <CardTitle>Customer accounts</CardTitle>
        <CardDescription>Let customers sign in to see their orders and keep their details.</CardDescription>
      </CardHeader>
      <CardContent>
        {shop.data ? (
          <CustomerAccountsForm key={shop.data.id} shop={shop.data} />
        ) : shop.error ? (
          <p className="text-sm text-destructive">{shop.error.message}</p>
        ) : (
          <Skeleton className="h-16 w-full" />
        )}
      </CardContent>
    </Card>
  )
}

function CustomerAccountsForm({ shop }: { shop: Shop }) {
  const queryClient = useQueryClient()
  const form = useZodForm(accountsInput, { defaultValues: toAccounts(shop) })
  const update = useMutation(orpc.admin.shop.update.mutationOptions())

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      const saved = await update.mutateAsync(values)
      queryClient.setQueryData(orpc.admin.shop.get.queryKey(), saved)
      form.reset(toAccounts(saved))
      toast.success('Customer account settings saved')
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
          name="customerAccounts"
          label="Customers can have an account"
          description="Off: your storefront shows no Account link and no sign-in page. Customers check out as guests. Their past orders stay in your admin."
        />
        <FormError form={form} />
        {isDirty && (
          <Field orientation="horizontal" className="justify-end">
            <Button type="button" variant="ghost" disabled={isSubmitting} onClick={() => form.reset()}>
              Discard
            </Button>
            <Button type="submit" variant="outline" disabled={isSubmitting}>
              {isSubmitting ? 'Saving…' : 'Save'}
            </Button>
          </Field>
        )}
      </FieldGroup>
    </form>
  )
}

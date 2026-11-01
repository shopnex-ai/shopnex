'use client'

import { useMutation, useQuery } from '@tanstack/react-query'
import { useNavigate, useRouter } from '@tanstack/react-router'
import { shopInput } from '@shopnex/api/schemas'
import { FormError, SelectField, TextField, setServerError, useZodForm } from '@/components/admin/form'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, FieldGroup } from '@/components/ui/field'
import { Skeleton } from '@/components/ui/skeleton'
import { clearAdminContext } from '@/lib/admin-context'
import { currencyOptions } from '@/lib/currency'
import { orpc } from '@/lib/orpc'

const input = shopInput.pick({ name: true, currency: true }).required()

// Shown right after the owner account is created: the two things that are awkward to change later (prices are
// stored in the shop's currency). Payments, shipping and the first product are on the Home checklist.
export function WelcomeWizard() {
  const { data: shop, error } = useQuery(orpc.admin.shop.get.queryOptions())
  return (
    <Card>
      <CardHeader>
        <CardTitle>Name your shop</CardTitle>
        <CardDescription>Shown to customers on your storefront and at checkout.</CardDescription>
      </CardHeader>
      <CardContent>
        {shop ? (
          <ShopStep name={shop.name} currency={shop.currency} />
        ) : error ? (
          <p className="text-sm text-destructive">{error.message}</p>
        ) : (
          <Skeleton className="h-40 w-full" />
        )}
      </CardContent>
    </Card>
  )
}

function ShopStep({ name, currency }: { name: string; currency: string }) {
  const navigate = useNavigate()
  const router = useRouter()
  const form = useZodForm(input, { defaultValues: { name, currency } })
  const update = useMutation(orpc.admin.shop.update.mutationOptions())
  const onSubmit = form.handleSubmit(async (values) => {
    try {
      await update.mutateAsync(values)
      // The sidebar and header show the shop name (server-rendered)
      clearAdminContext(router)
      await navigate({ to: '/admin', replace: true })
      await router.invalidate()
    } catch (error) {
      setServerError(form, error)
    }
  })
  return (
    <form onSubmit={onSubmit} noValidate>
      <FieldGroup>
        <TextField control={form.control} name="name" label="Shop name" autoComplete="off" autoFocus />
        <SelectField
          control={form.control}
          name="currency"
          label="Currency"
          description="Prices are stored in this currency."
          options={currencyOptions}
        />
        <FormError form={form} />
        <Field orientation="horizontal" className="justify-end">
          <Button type="submit" disabled={form.formState.isSubmitting}>
            {form.formState.isSubmitting ? 'Saving…' : 'Continue'}
          </Button>
        </Field>
      </FieldGroup>
    </form>
  )
}

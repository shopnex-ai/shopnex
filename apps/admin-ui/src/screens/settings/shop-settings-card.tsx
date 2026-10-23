'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useRouter } from '@tanstack/react-router'
import { toast } from 'sonner'
import { shopInput } from '@shopnex/api/schemas'
import { FormError, SelectField, TextField, TextareaField, setServerError, useZodForm } from '@/components/admin/form'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, FieldGroup } from '@/components/ui/field'
import { Skeleton } from '@/components/ui/skeleton'
import { clearAdminContext } from '@/lib/admin-context'
import { currencyOptions } from '@/lib/currency'
import { orpc, type Outputs } from '@/lib/orpc'

type Shop = Outputs['admin']['shop']['get']

const toValues = (shop: Shop) => ({
  name: shop.name,
  currency: shop.currency,
  storefrontUrl: shop.storefrontUrl,
  seoTitle: shop.seoTitle,
  seoDescription: shop.seoDescription,
})

export function ShopSettingsCard() {
  const { data: shop, error } = useQuery(orpc.admin.shop.get.queryOptions())
  return (
    <Card>
      <CardHeader>
        <CardTitle>Shop</CardTitle>
        <CardDescription>Shown to customers on your storefront and at checkout.</CardDescription>
      </CardHeader>
      <CardContent>
        {shop ? (
          // key: fresh defaults if the active shop changes
          <ShopForm key={shop.id} shop={shop} />
        ) : error ? (
          <p className="text-sm text-destructive">{error.message}</p>
        ) : (
          <Skeleton className="h-40 w-full" />
        )}
      </CardContent>
    </Card>
  )
}

function ShopForm({ shop }: { shop: Shop }) {
  const router = useRouter()
  const queryClient = useQueryClient()
  const form = useZodForm(shopInput, { defaultValues: toValues(shop) })
  const update = useMutation(orpc.admin.shop.update.mutationOptions())

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      const saved = await update.mutateAsync(values)
      queryClient.setQueryData(orpc.admin.shop.get.queryKey(), saved)
      form.reset(toValues(saved))
      toast.success('Settings saved')
      // The sidebar and header show the shop name (server-rendered)
      clearAdminContext(router)
      router.invalidate()
    } catch (error) {
      setServerError(form, error)
    }
  })

  const { isSubmitting, isDirty } = form.formState

  return (
    <form onSubmit={onSubmit} noValidate>
      <FieldGroup>
        <TextField control={form.control} name="name" label="Shop name" autoComplete="off" />
        <SelectField
          control={form.control}
          name="currency"
          label="Currency"
          description="Existing prices are not converted. Orders already placed keep their currency."
          options={currencyOptions}
        />
        <TextField
          control={form.control}
          name="storefrontUrl"
          label="Storefront URL"
          type="url"
          nullable
          placeholder="https://shop.example.com"
          description="Where your storefront lives. Checkout links back to it (“Continue shopping”)."
          autoComplete="off"
        />
        <TextField
          control={form.control}
          name="seoTitle"
          label="Homepage title"
          nullable
          placeholder={shop.name}
          description="Shown in search results and browser tabs. Leave empty to use the shop name."
          autoComplete="off"
        />
        <TextareaField
          control={form.control}
          name="seoDescription"
          label="Homepage meta description"
          nullable
          rows={3}
          description="A sentence or two about your store, shown under its title in search results."
        />
        <FormError form={form} />
        <Field orientation="horizontal" className="justify-end">
          {isDirty && (
            <Button type="button" variant="ghost" onClick={() => form.reset()}>
              Discard
            </Button>
          )}
          <Button type="submit" disabled={isSubmitting || !isDirty}>
            {isSubmitting ? 'Saving…' : 'Save'}
          </Button>
        </Field>
      </FieldGroup>
    </form>
  )
}

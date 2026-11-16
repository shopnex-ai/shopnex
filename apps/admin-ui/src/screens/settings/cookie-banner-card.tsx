'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { shopInput } from '@shopnex/api/schemas'
import { CheckboxField, FormError, setServerError, useZodForm } from '@/components/admin/form'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, FieldGroup } from '@/components/ui/field'
import { Skeleton } from '@/components/ui/skeleton'
import { orpc, type Outputs } from '@/lib/orpc'

type Shop = Outputs['admin']['shop']['get']

const bannerInput = shopInput.pick({ cookieBanner: true })
const toBanner = (shop: Shop) => ({ cookieBanner: shop.cookieBanner })

export function CookieBannerCard() {
  const shop = useQuery(orpc.admin.shop.get.queryOptions())
  return (
    <Card>
      <CardHeader>
        <CardTitle>Cookie banner</CardTitle>
        <CardDescription>
          Ask visitors for consent before the analytics and marketing scripts you add to your storefront run.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {shop.data ? (
          <CookieBannerForm key={shop.data.id} shop={shop.data} />
        ) : shop.error ? (
          <p className="text-sm text-destructive">{shop.error.message}</p>
        ) : (
          <Skeleton className="h-24 w-full" />
        )}
      </CardContent>
    </Card>
  )
}

function CookieBannerForm({ shop }: { shop: Shop }) {
  const queryClient = useQueryClient()
  const form = useZodForm(bannerInput, { defaultValues: toBanner(shop) })
  const update = useMutation(orpc.admin.shop.update.mutationOptions())

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      const saved = await update.mutateAsync(values)
      queryClient.setQueryData(orpc.admin.shop.get.queryKey(), saved)
      form.reset(toBanner(saved))
      toast.success('Cookie banner settings saved')
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
          name="cookieBanner"
          label="Show a cookie banner"
          description="Visitors choose Accept all or Reject all, and the choice is remembered. Your storefront itself only uses what it needs to work (the cart and sign-in), so you need this only if you add analytics or marketing scripts."
        />
        <div className="space-y-2 text-sm text-muted-foreground">
          <p>
            To hold a script back until the visitor agrees, add it to your theme with{' '}
            <code>type=&quot;text/plain&quot;</code> and a category:
          </p>
          <pre className="overflow-x-auto rounded-md bg-muted p-3 text-xs text-foreground">
            {'<script type="text/plain" data-consent="analytics" src="https://example.com/tag.js"></script>'}
          </pre>
          <p>
            Use <code>analytics</code>, <code>marketing</code>, or both (<code>analytics,marketing</code>). Add{' '}
            <code>{'<a href="#" data-shopnex-consent-settings>Cookie settings</a>'}</code> where visitors can change
            their mind. With the banner off, these scripts run at once.
          </p>
        </div>
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

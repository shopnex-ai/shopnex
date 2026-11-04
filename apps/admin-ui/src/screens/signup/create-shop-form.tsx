'use client'

import { useNavigate, useRouter } from '@tanstack/react-router'
import { z } from 'zod'
import { FormError, useZodForm } from '@/components/admin/form'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, FieldGroup } from '@/components/ui/field'
import { clearAdminContext } from '@/lib/admin-context'
import { createMyShop } from './actions'

// For a signed-in account that has no shop yet
export function CreateShopForm() {
  const navigate = useNavigate()
  const router = useRouter()
  const form = useZodForm(z.object({}), { defaultValues: {} })

  const onSubmit = form.handleSubmit(async () => {
    const { error } = await createMyShop()
    if (error) {
      form.setError('root', { message: error })
      return
    }
    clearAdminContext(router)
    // Same last step as every other sign-up: name the shop and pick the currency
    await navigate({ to: '/admin/welcome', replace: true })
    await router.invalidate()
  })

  return (
    <Card>
      <CardHeader>
        <CardTitle>Create your shop</CardTitle>
        <CardDescription>
          Your account isn&apos;t part of a shop yet. Next you&apos;ll name it and pick its currency.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} noValidate>
          <FieldGroup>
            <FormError form={form} />
            <Field>
              <Button type="submit" disabled={form.formState.isSubmitting}>
                {form.formState.isSubmitting ? 'Creating…' : 'Create shop'}
              </Button>
            </Field>
          </FieldGroup>
        </form>
      </CardContent>
    </Card>
  )
}

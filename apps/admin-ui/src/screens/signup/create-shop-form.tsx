'use client'

import { z } from 'zod'
import { FormError, useZodForm } from '@/components/admin/form'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, FieldGroup } from '@/components/ui/field'
import { useCreateShop } from './use-create-shop'

// For a signed-in account that has no shop yet
export function CreateShopForm() {
  const createShop = useCreateShop()
  const form = useZodForm(z.object({}), { defaultValues: {} })

  const onSubmit = form.handleSubmit(async () => {
    const error = await createShop()
    if (error) form.setError('root', { message: error })
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
              <Button data-ph-capture="create-shop" type="submit" disabled={form.formState.isSubmitting}>
                {form.formState.isSubmitting ? 'Creating…' : 'Create shop'}
              </Button>
            </Field>
          </FieldGroup>
        </form>
      </CardContent>
    </Card>
  )
}

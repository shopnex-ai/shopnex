'use client'

import { useRouter } from '@tanstack/react-router'
import { createShopInput } from '@shopnex/api/schemas'
import { FormError, TextField, useZodForm } from '@/components/admin/form'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, FieldGroup } from '@/components/ui/field'
import { clearAdminContext } from '@/lib/admin-context'
import { createMyShop } from './actions'

// For a signed-in account that has no shop yet
export function CreateShopForm() {
  const router = useRouter()
  const form = useZodForm(createShopInput, { defaultValues: { shopName: '' } })

  const onSubmit = form.handleSubmit(async (values) => {
    const { error } = await createMyShop({ data: values })
    if (error) {
      form.setError('root', { message: error })
      return
    }
    clearAdminContext(router)
    await router.invalidate()
  })

  return (
    <Card>
      <CardHeader>
        <CardTitle>Create your shop</CardTitle>
        <CardDescription>Your account isn&apos;t part of a shop yet. Name yours to get started.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} noValidate>
          <FieldGroup>
            <TextField control={form.control} name="shopName" label="Shop name" autoFocus />
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

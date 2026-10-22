'use client'

import { useNavigate, useRouter } from '@tanstack/react-router'
import { MIN_PASSWORD, setupInput } from '@shopnex/api/schemas'
import { authClient } from '@shopnex/auth/client'
import { FormError, SelectField, TextField, useZodForm } from '@/components/admin/form'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, FieldGroup, FieldSeparator } from '@/components/ui/field'
import { currencyOptions } from '@/lib/currency'
import { runSetup } from './actions'

export function SetupForm() {
  const navigate = useNavigate()
  const router = useRouter()
  const form = useZodForm(setupInput, {
    defaultValues: { name: '', email: '', password: '', shopName: '', currency: 'USD' },
  })

  const onSubmit = form.handleSubmit(async (values) => {
    const { error } = await runSetup({ data: values })
    if (error) {
      form.setError('root', { message: error })
      return
    }
    const signIn = await authClient.signIn.email({ email: values.email, password: values.password })
    // The account exists either way; worst case they sign in by hand
    await navigate({ to: signIn.error ? '/admin/login' : '/admin', replace: true })
    await router.invalidate()
  })

  return (
    <Card>
      <CardHeader>
        <CardTitle>Welcome to Shopnex</CardTitle>
        <CardDescription>
          Create the owner account and name your shop. You can change the shop later in Settings.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} noValidate>
          <FieldGroup>
            <TextField control={form.control} name="shopName" label="Shop name" placeholder="Acme Goods" />
            <SelectField
              control={form.control}
              name="currency"
              label="Currency"
              description="All prices in your shop use this currency."
              options={currencyOptions}
            />
            <FieldSeparator>Owner account</FieldSeparator>
            <TextField control={form.control} name="name" label="Your name" autoComplete="name" />
            <TextField control={form.control} name="email" label="Email" type="email" autoComplete="email" />
            <TextField
              control={form.control}
              name="password"
              label="Password"
              type="password"
              autoComplete="new-password"
              description={`At least ${MIN_PASSWORD} characters.`}
            />
            <FormError form={form} />
            <Field>
              <Button type="submit" disabled={form.formState.isSubmitting}>
                {form.formState.isSubmitting ? 'Setting up…' : 'Create shop'}
              </Button>
            </Field>
          </FieldGroup>
        </form>
      </CardContent>
    </Card>
  )
}

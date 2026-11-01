'use client'

import { useNavigate, useRouter } from '@tanstack/react-router'
import { MIN_PASSWORD, setupInput } from '@shopnex/api/schemas'
import { authClient } from '@shopnex/auth/client'
import { FormError, TextField, useZodForm } from '@/components/admin/form'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, FieldGroup } from '@/components/ui/field'
import { clearAdminContext } from '@/lib/admin-context'
import { runSetup } from './actions'

export function SetupForm() {
  const navigate = useNavigate()
  const router = useRouter()
  const form = useZodForm(setupInput, {
    defaultValues: { email: '', password: '' },
  })

  const onSubmit = form.handleSubmit(async (values) => {
    const { error } = await runSetup({ data: values })
    if (error) {
      form.setError('root', { message: error })
      return
    }
    const signIn = await authClient.signIn.email({ email: values.email, password: values.password })
    // The account exists either way; worst case they sign in by hand
    clearAdminContext(router)
    await navigate({ to: signIn.error ? '/admin/login' : '/admin', replace: true })
    await router.invalidate()
  })

  return (
    <Card>
      <CardHeader>
        <CardTitle>Welcome to Shopnex</CardTitle>
        <CardDescription>
          Create the owner account. You can name your shop and set its currency later in Settings.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} noValidate>
          <FieldGroup>
            <TextField control={form.control} name="email" label="Email" type="email" autoComplete="email" autoFocus />
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
                {form.formState.isSubmitting ? 'Setting up…' : 'Create account'}
              </Button>
            </Field>
          </FieldGroup>
        </form>
      </CardContent>
    </Card>
  )
}

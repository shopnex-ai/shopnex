'use client'

import { Link, useNavigate, useRouter } from '@tanstack/react-router'
import { MIN_PASSWORD, signupInput } from '@shopnex/api/schemas'
import { authClient } from '@shopnex/auth/client'
import type { SocialProvider } from '@shopnex/auth/providers'
import { SocialButtons } from '@/components/auth/social-buttons'
import { FormError, TextField, useZodForm } from '@/components/admin/form'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, FieldGroup } from '@/components/ui/field'
import { clearAdminContext } from '@/lib/admin-context'
import { runSignup } from './actions'

export function SignupForm({ providers }: { providers: SocialProvider[] }) {
  const navigate = useNavigate()
  const router = useRouter()
  const form = useZodForm(signupInput, { defaultValues: { shopName: '', email: '', password: '' } })

  const onSubmit = form.handleSubmit(async (values) => {
    const { error } = await runSignup({ data: values })
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
        <CardTitle>Start your store</CardTitle>
        <CardDescription>Create an account and your own shop. You can rename it later in Settings.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} noValidate>
          <FieldGroup>
            <TextField control={form.control} name="shopName" label="Shop name" autoFocus />
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
                {form.formState.isSubmitting ? 'Creating your store…' : 'Create store'}
              </Button>
            </Field>
            <SocialButtons providers={providers} mode="sign-up" />
          </FieldGroup>
        </form>
      </CardContent>
      <CardFooter className="justify-center text-sm text-muted-foreground">
        Already have a store?&nbsp;
        <Link to="/admin/login" className="underline">
          Log in
        </Link>
      </CardFooter>
    </Card>
  )
}

'use client'

import { Link, useNavigate, useRouter } from '@tanstack/react-router'
import { MIN_PASSWORD, setupInput } from '@shopnex/api/schemas'
import { authClient } from '@shopnex/auth/client'
import type { SocialProvider } from '@shopnex/auth/providers'
import { SocialButtons } from '@/components/auth/social-buttons'
import { FormError, TextField, useZodForm } from '@/components/admin/form'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, FieldGroup } from '@/components/ui/field'
import { clearAdminContext } from '@/lib/admin-context'

export function SignupForm({ providers }: { providers: SocialProvider[] }) {
  const navigate = useNavigate()
  const router = useRouter()
  const form = useZodForm(setupInput, { defaultValues: { email: '', password: '' } })

  const onSubmit = form.handleSubmit(async (values) => {
    // Signs the new account in too. Better Auth rate limits this per address; the shop comes next.
    const signUp = await authClient.signUp.email({ ...values, name: values.email.split('@')[0]!.slice(0, 100) })
    if (signUp.error) {
      form.setError('root', { message: signUp.error.message ?? 'Sign-up failed' })
      return
    }
    // Signing up made the shop too (createShopForNewAccount in @shopnex/auth)
    clearAdminContext(router)
    await navigate({ to: '/admin/welcome', replace: true })
    await router.invalidate()
  })

  return (
    <Card>
      <CardHeader>
        <CardTitle>Start your store</CardTitle>
        <CardDescription>
          Create an account and your own shop. Next you'll name it and pick its currency.
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
              <Button data-ph-capture="signup" type="submit" disabled={form.formState.isSubmitting}>
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

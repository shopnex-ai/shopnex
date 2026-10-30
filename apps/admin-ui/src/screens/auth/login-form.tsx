'use client'

import { useNavigate, useRouter } from '@tanstack/react-router'
import { useEffect, useState, type FormEvent } from 'react'
import { toast } from 'sonner'
import { authClient } from '@shopnex/auth/client'
import type { SocialProvider } from '@shopnex/auth/providers'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { clearAdminContext } from '@/lib/admin-context'
import { SocialButtons } from './social-buttons'

// Only same-app admin paths, so ?next= can't be used to send people elsewhere
const safeNext = (next?: string) => (next?.startsWith('/admin/') && !next.startsWith('//') ? next : '/admin')

export function LoginForm({
  providers,
  error,
  next,
  defaults,
}: {
  providers: SocialProvider[]
  error?: string
  next?: string
  defaults?: { email: string; password: string } | null
}) {
  const destination = safeNext(next)
  const navigate = useNavigate()
  const router = useRouter()
  const [pending, setPending] = useState(false)
  // Until the page is interactive a click on Login would submit the form natively: a GET that puts the
  // password in the URL and reloads the page, losing what was typed
  const [ready, setReady] = useState(false)
  useEffect(() => setReady(true), [])

  // OAuth failures come back as /admin/login?error=...
  useEffect(() => {
    if (error) toast.error(`Sign in failed: ${error.replaceAll('_', ' ')}`)
  }, [error])

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = new FormData(e.currentTarget)
    setPending(true)
    const { error } = await authClient.signIn.email({
      email: String(form.get('email')),
      password: String(form.get('password')),
    })
    setPending(false)
    if (error) {
      toast.error(error.message ?? 'Could not sign in')
      return
    }
    clearAdminContext(router)
    await navigate({ href: destination, replace: true })
    await router.invalidate()
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Login to your account</CardTitle>
        <CardDescription>Enter your email below to login to your account</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit}>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="email">Email</FieldLabel>
              <Input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                placeholder="m@example.com"
                defaultValue={defaults?.email}
                required
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="password">Password</FieldLabel>
              <Input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                defaultValue={defaults?.password}
                required
              />
            </Field>
            <Field>
              <Button type="submit" disabled={pending || !ready}>
                {pending ? 'Logging in…' : 'Login'}
              </Button>
            </Field>
            <SocialButtons providers={providers} mode="login" callbackURL={destination} />
            <Field>
              <FieldDescription className="text-center">New here? Ask a shop owner to invite you.</FieldDescription>
            </Field>
          </FieldGroup>
        </form>
      </CardContent>
    </Card>
  )
}

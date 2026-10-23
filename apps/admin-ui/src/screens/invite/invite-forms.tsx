'use client'

import { useNavigate, useRouter } from '@tanstack/react-router'
import { useState, type FormEvent } from 'react'
import { toast } from 'sonner'
import { MIN_PASSWORD } from '@shopnex/api/schemas'
import { authClient } from '@shopnex/auth/client'
import type { SocialProvider } from '@shopnex/auth/providers'
import { SocialButtons } from '@/components/auth/social-buttons'
import { Button } from '@/components/ui/button'
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { clearAdminContext } from '@/lib/admin-context'

// Accepting makes them a member and sets this shop as their active one
async function accept(invitationId: string) {
  const { error } = await authClient.organization.acceptInvitation({ invitationId })
  if (error) toast.error(error.message ?? 'Could not accept the invitation')
  return !error
}

export function AcceptInvitation({ invitationId }: { invitationId: string }) {
  const navigate = useNavigate()
  const router = useRouter()
  const [pending, setPending] = useState(false)
  return (
    <Button
      className="w-full"
      disabled={pending}
      onClick={async () => {
        setPending(true)
        if (await accept(invitationId)) {
          clearAdminContext(router)
          await navigate({ to: '/admin', replace: true })
          await router.invalidate()
        } else {
          setPending(false)
        }
      }}
    >
      {pending ? 'Joining…' : 'Accept invitation'}
    </Button>
  )
}

export function InviteSignUpForm({
  invitationId,
  email,
  providers,
  callbackURL,
}: {
  invitationId: string
  email: string
  providers: SocialProvider[]
  callbackURL: string
}) {
  const navigate = useNavigate()
  const router = useRouter()
  const [pending, setPending] = useState(false)

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = new FormData(e.currentTarget)
    setPending(true)
    const { error } = await authClient.signUp.email({
      name: String(form.get('name')),
      email,
      password: String(form.get('password')),
    })
    if (error) {
      setPending(false)
      toast.error(error.message ?? 'Could not create account')
      return
    }
    // Signed in now; joining can still fail (e.g. the invite was cancelled meanwhile) — the page then explains
    await accept(invitationId)
    clearAdminContext(router)
    await navigate({ to: '/admin', replace: true })
    await router.invalidate()
  }

  return (
    <form onSubmit={onSubmit}>
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="email">Email</FieldLabel>
          <Input id="email" value={email} readOnly disabled />
        </Field>
        <Field>
          <FieldLabel htmlFor="name">Full name</FieldLabel>
          <Input id="name" name="name" autoComplete="name" required />
        </Field>
        <Field>
          <FieldLabel htmlFor="password">Password</FieldLabel>
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="new-password"
            minLength={MIN_PASSWORD}
            required
          />
          <FieldDescription>At least {MIN_PASSWORD} characters.</FieldDescription>
        </Field>
        <Field>
          <Button type="submit" disabled={pending}>
            {pending ? 'Joining…' : 'Create account and join'}
          </Button>
        </Field>
        {/* OAuth comes back to the invite page, which then shows "Accept" (the provider email must match) */}
        <SocialButtons providers={providers} mode="sign-up" callbackURL={callbackURL} />
      </FieldGroup>
    </form>
  )
}

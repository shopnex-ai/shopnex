'use client'

import { useNavigate, useRouter } from '@tanstack/react-router'
import { authClient } from '@shopnex/auth/client'
import { Button } from '@/components/ui/button'

export function useSignOut() {
  const navigate = useNavigate()
  const router = useRouter()
  return async () => {
    await authClient.signOut()
    await navigate({ to: '/admin/login', replace: true })
    await router.invalidate()
  }
}

export function SignOutButton() {
  const signOut = useSignOut()
  return (
    <Button variant="outline" size="sm" onClick={signOut}>
      Sign out
    </Button>
  )
}

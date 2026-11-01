'use client'

import { useNavigate, useRouter } from '@tanstack/react-router'
import { toast } from 'sonner'
import { authClient } from '@shopnex/auth/client'
import { Button } from '@/components/ui/button'
import { clearAdminContext } from '@/lib/admin-context'

export function useSignOut() {
  const navigate = useNavigate()
  const router = useRouter()
  return async () => {
    try {
      const { error } = await authClient.signOut()
      if (error) {
        toast.error(error.message ?? 'Could not sign out')
        return
      }
      clearAdminContext(router)
      await navigate({ to: '/admin/login', replace: true })
      await router.invalidate()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not sign out')
    }
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

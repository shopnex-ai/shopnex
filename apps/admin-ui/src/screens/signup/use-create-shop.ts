import { useNavigate, useRouter } from '@tanstack/react-router'
import { clearAdminContext } from '@/lib/admin-context'
import { createMyShop } from './actions'

// Makes the signed-in account's shop, then continues to the welcome step (name and currency), the same last step as
// first-run setup. Returns the error message, if any.
export function useCreateShop() {
  const navigate = useNavigate()
  const router = useRouter()
  return async () => {
    const { error } = await createMyShop()
    if (error) return error
    clearAdminContext(router)
    await navigate({ to: '/admin/welcome', replace: true })
    await router.invalidate()
  }
}

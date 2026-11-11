import { createFileRoute, redirect } from '@tanstack/react-router'
import { adminContextQuery } from '@/lib/admin-context'
import { createMyShop } from '@/screens/signup/actions'

// Where Google and GitHub send a new account back from /admin/signup: makes its shop, like the email form does, then
// continues to the welcome step. If that fails (or they already have a shop) /admin decides what to show.
export const Route = createFileRoute('/admin/create-shop')({
  beforeLoad: async ({ context }) => {
    const { error } = await createMyShop()
    context.queryClient.removeQueries({ queryKey: adminContextQuery.queryKey })
    throw redirect({ to: error ? '/admin' : '/admin/welcome' })
  },
})

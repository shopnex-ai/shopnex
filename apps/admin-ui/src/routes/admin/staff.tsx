import { createFileRoute, redirect } from '@tanstack/react-router'

// Staff moved under Settings
export const Route = createFileRoute('/admin/staff')({
  beforeLoad: () => {
    throw redirect({ to: '/admin/settings/staff' })
  },
})

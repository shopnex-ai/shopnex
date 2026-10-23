import { createFileRoute, Outlet, redirect, useLocation } from '@tanstack/react-router'
import { Separator } from '@/components/ui/separator'
import { SidebarInset, SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar'
import { AppSidebar } from '@/components/admin/app-sidebar'
import { SignOutButton } from '@/components/auth/sign-out-button'
import { NavigationProgress } from '@/components/admin/navigation-progress'
import { adminContextQuery } from '@/lib/admin-context'

export const Route = createFileRoute('/admin')({
  beforeLoad: async ({ location, context }) => {
    const access = await context.queryClient.ensureQueryData(adminContextQuery)
    if (location.pathname === '/admin/setup') {
      if (access.setupComplete) throw redirect({ to: '/admin/login' })
      return { access }
    }
    if (location.pathname === '/admin/login') {
      if (!access.setupComplete) throw redirect({ to: '/admin/setup' })
      if (access.session) throw redirect({ to: '/admin' })
      return { access }
    }
    if (location.pathname.startsWith('/admin/invite/')) {
      if (!access.setupComplete) throw redirect({ to: '/admin/setup' })
      return { access }
    }
    if (!access.setupComplete) throw redirect({ to: '/admin/setup' })
    if (!access.session) {
      const next = `${location.pathname}${location.searchStr}`
      throw redirect({ to: '/admin/login', search: { next } })
    }
    return { access }
  },
  component: AdminLayout,
})

function AdminLayout() {
  const { access } = Route.useRouteContext()
  const pathname = useLocation({ select: (location) => location.pathname })
  if (pathname === '/admin/setup' || pathname === '/admin/login' || pathname.startsWith('/admin/invite/'))
    return <Outlet />
  const { session, tenant } = access
  // No session: beforeLoad is redirecting. The context is stale for a moment while navigating
  // from /admin/login, so render nothing instead of flashing a message.
  if (!session) return null
  if (!tenant) {
    return (
      <main className="flex min-h-svh flex-col items-center justify-center gap-4 p-6 text-center">
        <p className="text-muted-foreground">You are not a member of a shop yet, or you do not have access to one.</p>
        <SignOutButton />
      </main>
    )
  }
  return (
    <SidebarProvider defaultOpen>
      <NavigationProgress />
      <AppSidebar
        shop={{ name: tenant.shop.name, superAdmin: tenant.superAdmin }}
        user={{ name: session.user.name, email: session.user.email, image: session.user.image }}
      />
      <SidebarInset>
        <header className="flex h-12 shrink-0 items-center gap-2 border-b px-4">
          <SidebarTrigger className="-ml-1" />
          <Separator orientation="vertical" className="mr-2 data-vertical:h-4" />
          <span className="text-sm text-muted-foreground">{tenant.shop.name}</span>
        </header>
        <div className="flex-1 p-4 md:p-6">
          <Outlet />
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}

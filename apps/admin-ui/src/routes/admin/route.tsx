import { createFileRoute, Outlet, redirect, useRouterState } from '@tanstack/react-router'
import { ExternalLinkIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { SidebarInset, SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar'
import { AppSidebar } from '@/components/admin/app-sidebar'
import { SignOutButton } from '@/components/auth/sign-out-button'
import { NavigationProgress } from '@/components/admin/navigation-progress'
import { ShopnexBrand } from '@/components/admin/shopnex-logo'
import { isShopManager } from '@/lib/admin-access'
import { adminContextQuery, installedAppsQuery } from '@/lib/admin-context'
import { analyticsScript } from '@/lib/analytics'
import { getAnalyticsConfig } from '@/lib/session.functions'
import { CreateShopForm } from '@/screens/signup/create-shop-form'

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
    if (location.pathname === '/admin/signup') {
      if (!access.setupComplete) throw redirect({ to: '/admin/setup' })
      if (!access.openSignup || access.session) throw redirect({ to: access.session ? '/admin' : '/admin/login' })
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
    // Only owners and admins see installed apps in the sidebar
    const canManageApps = isShopManager(access.tenant)
    // 'static': use what is cached (the sidebar and invalidations keep it fresh), like ensureQueryData did
    const installedApps = canManageApps
      ? await context.queryClient.query({ ...installedAppsQuery, staleTime: 'static' })
      : []
    return { access, installedApps }
  },
  // Admin pages only. The root route also serves the hosted checkout, which is the merchant's shoppers: never tracked.
  loader: () => getAnalyticsConfig(),
  // Login, signup, setup and the whole admin stay out of search results. noindex (not a robots.txt block) so crawlers can still read it.
  head: ({ loaderData }) => ({
    meta: [{ name: 'robots', content: 'noindex, nofollow' }],
    scripts: loaderData ? [{ children: analyticsScript(loaderData) }] : [],
  }),
  component: AdminLayout,
})

function AdminLayout() {
  const { access } = Route.useRouteContext()
  // The page that is on screen, not the one being navigated to: `location` changes the moment a navigation starts, while
  // the old page stays until the next route's beforeLoad (the admin context fetch) is done. Following it made the
  // sidebar vanish on sign-out, and left a blank page on sign-in, until the server answered.
  const pathname = useRouterState({ select: (state) => (state.resolvedLocation ?? state.location).pathname })
  if (
    pathname === '/admin/setup' ||
    pathname === '/admin/login' ||
    pathname === '/admin/signup' ||
    pathname === '/admin/welcome' ||
    pathname.startsWith('/admin/invite/')
  )
    return <Outlet />
  const { session, tenant } = access
  // No session: beforeLoad is redirecting. The context is stale for a moment while navigating
  // from /admin/login, so render nothing instead of flashing a message.
  if (!session) return null
  if (!tenant && access.openSignup) {
    return (
      <div className="flex min-h-svh w-full items-center justify-center p-6 md:p-10">
        <div className="w-full max-w-md">
          <ShopnexBrand />
          <CreateShopForm />
        </div>
      </div>
    )
  }
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
        shop={{
          id: tenant.shop.id,
          name: tenant.shop.name,
          superAdmin: tenant.superAdmin,
          canManageApps: isShopManager(tenant),
        }}
        user={{ name: session.user.name, email: session.user.email, image: session.user.image }}
      />
      <SidebarInset>
        <header className="flex h-12 shrink-0 items-center gap-2 border-b px-4">
          <SidebarTrigger className="-ml-1" />
          {tenant.shop.storefrontUrl && (
            <Button
              variant="ghost"
              size="sm"
              className="ml-auto"
              render={<a href={tenant.shop.storefrontUrl} target="_blank" rel="noopener" />}
            >
              View store
              <ExternalLinkIcon />
            </Button>
          )}
        </header>
        <div className="flex-1 p-4 md:p-6">
          <Outlet />
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}

import { createFileRoute, Outlet, redirect, useRouterState } from '@tanstack/react-router'
import { useEffect, useRef } from 'react'
import { ExternalLinkIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { SidebarInset, SidebarProvider, SidebarTrigger, useSidebar } from '@/components/ui/sidebar'
import { AppSidebar } from '@/components/admin/app-sidebar'
import { ACTIONS_SLOT, TITLE_SLOT, TopBarContext } from '@/components/admin/page-header'
import { SignOutButton } from '@/components/auth/sign-out-button'
import { NavigationProgress } from '@/components/admin/navigation-progress'
import { ShopnexBrand } from '@/components/admin/shopnex-logo'
import { isShopManager } from '@/lib/admin-access'
import { adminContextQuery, installedAppsQuery } from '@/lib/admin-context'
import {
  getListCounts,
  listCountsQuery,
  listKeyForPath,
  useLoadOtherListCounts,
  type ListCounts,
} from '@/lib/list-counts'
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
      const importUrl = new URLSearchParams(location.searchStr).get('import')
      if (!access.setupComplete) throw redirect({ to: '/admin/setup', search: { import: importUrl?.slice(0, 300) } })
      // Already signed in with a store address in the link: import it into their shop instead of dropping it
      if (access.session && importUrl) {
        throw redirect({ to: '/admin/settings/import', search: { url: importUrl.slice(0, 300) } })
      }
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
    // The row count of the list this page shows, so it can draw the right thing before its own request is back. Only
    // while the server renders the page: a navigation inside the admin must not wait for it.
    let listCounts = context.queryClient.getQueryData<ListCounts>(listCountsQuery.queryKey)
    const listKey = listKeyForPath(location.pathname)
    if (canManageApps && listKey && listCounts?.[listKey] === undefined && typeof window === 'undefined') {
      const fresh = await getListCounts({ data: { keys: [listKey] } })
      listCounts = context.queryClient.setQueryData<ListCounts>(listCountsQuery.queryKey, (old) => ({
        ...old,
        ...fresh,
      }))
    }
    return { access, installedApps, listCounts }
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
  useLoadOtherListCounts(isShopManager(access.tenant))
  // Decide from the page that is actually rendered (the router's matches, which is what <Outlet /> shows), never from
  // a location: `location` changes the moment a navigation starts and `resolvedLocation` is updated separately from the
  // matches, so either can disagree with the page on screen and wrap it in the wrong chrome (the welcome step inside
  // the sidebar). Routes opt out of the chrome with `staticData: { standalone: true }`.
  const standalone = useRouterState({ select: (state) => state.matches.some((match) => match.staticData?.standalone) })
  if (standalone) return <Outlet />
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
    <TopBarContext.Provider value>
      <SidebarProvider defaultOpen>
        <NavigationProgress />
        <CollapseSidebarForEditors />
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
            <SidebarTrigger className="-ml-1 md:hidden" />
            <div id={TITLE_SLOT} className="flex min-w-0 items-center gap-2" />
            <div id={ACTIONS_SLOT} className="ml-auto flex items-center gap-2" />
            {tenant.shop.storefrontUrl && (
              <Button
                variant="ghost"
                size="sm"
                className="max-md:hidden"
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
    </TopBarContext.Provider>
  )
}

// Routes with `staticData: { collapseSidebar: true }` get the room: the sidebar collapses while one is open (moving between
// them keeps it collapsed) and opens again after. A sidebar the user had closed is left alone.
function CollapseSidebarForEditors() {
  const { open, setOpen } = useSidebar()
  const openRef = useRef(open)
  openRef.current = open
  const collapse = useRouterState({
    select: (state) => state.matches.some((match) => match.staticData?.collapseSidebar),
  })
  useEffect(() => {
    if (!collapse || !openRef.current) return
    setOpen(false)
    return () => setOpen(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- setOpen changes with `open`; this runs when entering or leaving the editors
  }, [collapse])
  return null
}

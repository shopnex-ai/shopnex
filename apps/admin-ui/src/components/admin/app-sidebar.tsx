'use client'

import {
  ArrowLeftIcon,
  CheckIcon,
  ChevronsUpDownIcon,
  ExternalLinkIcon,
  LogOutIcon,
  MonitorIcon,
  MoonIcon,
  SettingsIcon,
  StoreIcon,
  SunIcon,
} from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { Link, useLocation, useRouteContext } from '@tanstack/react-router'
import { useTheme } from 'next-themes'
import { toast } from 'sonner'
import { GlobalSearch } from '@/components/admin/global-search'
import { nav, settingsNav, type ExternalNavItem, type NavItem } from '@/components/admin/nav'
import { ShopnexBadge } from '@/components/admin/shopnex-logo'
import { UpdateMenuItem, VersionLabel } from '@/components/admin/update-notice'
import { useSignOut } from '@/components/auth/sign-out-button'
import { AppIcon } from '@/screens/apps/installed-apps-card'
import { orpc } from '@/lib/orpc'
import { getSwitchableShops, switchShop } from '@/lib/session.functions'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  useSidebar,
} from '@/components/ui/sidebar'

export type SidebarShop = {
  id: string
  name: string
  superAdmin: boolean
  /** Sees installed apps under Apps */ canManageApps: boolean
}
export type SidebarUser = {
  name: string
  email: string
  image?: string | null
}

const initials = (text: string) =>
  text
    .split(/[\s@._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join('')

export function AppSidebar({ shop, user }: { shop: SidebarShop; user: SidebarUser }) {
  const inSettings = useLocation({
    select: (location) => location.pathname === '/admin/settings' || location.pathname.startsWith('/admin/settings/'),
  })
  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>{inSettings ? <SettingsHeader /> : <ShopIdentity shop={shop} />}</SidebarHeader>
      <SidebarContent>
        <SidebarGroup className="pb-0">
          <SidebarMenu>
            <GlobalSearch superAdmin={shop.superAdmin} canManageApps={shop.canManageApps} />
          </SidebarMenu>
        </SidebarGroup>
        {(inSettings ? settingsNav : nav).map((group) => (
          <NavGroup key={group.label} {...group} canManageApps={shop.canManageApps} superAdmin={shop.superAdmin} />
        ))}
        <SidebarGroup className="mt-auto">
          <SidebarMenu>
            {!inSettings && (
              <SidebarMenuItem>
                <SidebarMenuButton render={<Link to="/admin/settings" />} tooltip="Settings" size="sm">
                  <SettingsIcon />
                  <span>Settings</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            )}
            <UpdateMenuItem enabled={shop.superAdmin} />
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <UserMenu user={user} superAdmin={shop.superAdmin} />
      </SidebarFooter>
    </Sidebar>
  )
}

// Single mode (or one shop): just the name. Multi mode with several shops: a switcher. The page reloads after a
// switch so nothing cached for the previous shop survives.
function ShopIdentity({ shop }: { shop: SidebarShop }) {
  const { isMobile } = useSidebar()
  const { data: shops = [] } = useQuery({ queryKey: ['switchable-shops'], queryFn: () => getSwitchableShops() })
  const switchable = shops.length > 1 || (shop.superAdmin && shops.length > 0)

  const identity = (
    <>
      <ShopnexBadge />
      <div className="grid flex-1 text-left leading-tight">
        <span className="truncate font-semibold">{shop.name}</span>
        <span className="truncate text-xs text-muted-foreground">
          {shop.superAdmin ? 'Super admin' : 'ShopNex Admin'}
        </span>
      </div>
    </>
  )

  async function onSwitch(shopId: string) {
    const { ok } = await switchShop({ data: shopId })
    if (ok) window.location.assign('/admin')
    else toast.error('Could not switch shops')
  }

  if (!switchable) {
    return (
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton size="lg" render={<Link to="/admin" />} tooltip={shop.name}>
            {identity}
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    )
  }

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger render={<SidebarMenuButton size="lg" className="data-popup-open:bg-sidebar-accent" />}>
            {identity}
            <ChevronsUpDownIcon className="ml-auto" />
          </DropdownMenuTrigger>
          <DropdownMenuContent
            side={isMobile ? 'bottom' : 'right'}
            align="start"
            sideOffset={4}
            className="max-h-80 min-w-56 overflow-y-auto"
          >
            <DropdownMenuGroup>
              <DropdownMenuLabel>Shops</DropdownMenuLabel>
              {shops.map((s) => (
                <DropdownMenuItem key={s.id} onClick={() => s.id !== shop.id && void onSwitch(s.id)}>
                  <StoreIcon />
                  <span className="truncate">{s.name}</span>
                  {s.id === shop.id && <CheckIcon className="ml-auto" />}
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}

function SettingsHeader() {
  const { isMobile, setOpenMobile } = useSidebar()
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <SidebarMenuButton
          size="lg"
          render={<Link to="/admin" onClick={() => isMobile && setOpenMobile(false)} />}
          tooltip="Back to admin"
        >
          <div className="flex aspect-square size-8 items-center justify-center rounded-lg border">
            <ArrowLeftIcon className="size-4" />
          </div>
          <div className="grid flex-1 text-left leading-tight">
            <span className="truncate font-semibold">Settings</span>
            <span className="truncate text-xs text-muted-foreground">Back to admin</span>
          </div>
        </SidebarMenuButton>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}

function NavGroup({
  label,
  items,
  canManageApps,
  superAdmin,
}: {
  label: string
  items: (NavItem | ExternalNavItem)[]
  canManageApps: boolean
  superAdmin: boolean
}) {
  const pathname = useLocation({ select: (location) => location.pathname })
  const { isMobile, setOpenMobile } = useSidebar()
  const visible = items.filter((item) => !item.superAdminOnly || superAdmin)
  // A group that is all super admin pages has nothing to show everyone else
  if (visible.length === 0) return null
  return (
    <SidebarGroup>
      <SidebarGroupLabel>{label}</SidebarGroupLabel>
      <SidebarMenu>
        {visible.map((item) =>
          item.external ? (
            <SidebarMenuItem key={item.href}>
              <SidebarMenuButton render={<a href={item.href} target="_blank" rel="noopener" />} tooltip={item.label}>
                <item.icon />
                <span>{item.label}</span>
                <ExternalLinkIcon className="ml-auto opacity-50" />
              </SidebarMenuButton>
            </SidebarMenuItem>
          ) : (
            <SidebarMenuItem key={item.href}>
              <SidebarMenuButton
                render={<Link to={item.href} onClick={() => isMobile && setOpenMobile(false)} />}
                isActive={
                  item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(`${item.href}/`)
                }
                tooltip={item.label}
              >
                <item.icon />
                <span>{item.label}</span>
              </SidebarMenuButton>
              {canManageApps && item.href === '/admin/apps' && <InstalledApps />}
            </SidebarMenuItem>
          ),
        )}
      </SidebarMenu>
    </SidebarGroup>
  )
}

// Installed apps, one click from the sidebar. Installing or uninstalling refreshes the list (apps query key).
function InstalledApps() {
  const pathname = useLocation({ select: (location) => location.pathname })
  const { isMobile, setOpenMobile } = useSidebar()
  // Loaded with the layout (beforeLoad), so the list is there on the first paint, also after a full page load
  // (the setup, login and signup pages skip it, hence the fallback)
  const initial = useRouteContext({ from: '/admin' }).installedApps ?? []
  const { data: apps } = useQuery({ ...orpc.admin.apps.list.queryOptions(), initialData: initial })
  if (!apps.length) return null
  return (
    <SidebarMenuSub>
      {apps.map((i) => (
        <SidebarMenuSubItem key={i.id}>
          <SidebarMenuSubButton
            render={
              <Link to="/admin/apps/$id" params={{ id: i.id }} onClick={() => isMobile && setOpenMobile(false)} />
            }
            isActive={pathname === `/admin/apps/${i.id}`}
          >
            <AppIcon url={i.app.iconUrl} className="size-4 rounded-sm" />
            <span>{i.app.name}</span>
          </SidebarMenuSubButton>
        </SidebarMenuSubItem>
      ))}
    </SidebarMenuSub>
  )
}

function UserMenu({ user, superAdmin }: { user: SidebarUser; superAdmin: boolean }) {
  const { isMobile } = useSidebar()
  const { theme, setTheme } = useTheme()
  const signOut = useSignOut()
  const fallback = initials(user.name || user.email)

  const identity = (
    <>
      <Avatar className="size-8 rounded-lg">
        {user.image && <AvatarImage src={user.image} alt="" />}
        <AvatarFallback className="rounded-lg">{fallback}</AvatarFallback>
      </Avatar>
      <div className="grid flex-1 text-left text-sm leading-tight">
        <span className="truncate font-medium">{user.name || user.email}</span>
        {user.name && <span className="truncate text-xs text-muted-foreground">{user.email}</span>}
      </div>
    </>
  )

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger render={<SidebarMenuButton size="lg" className="data-popup-open:bg-sidebar-accent" />}>
            {identity}
            <ChevronsUpDownIcon className="ml-auto" />
          </DropdownMenuTrigger>
          <DropdownMenuContent side={isMobile ? 'bottom' : 'right'} align="end" sideOffset={4} className="min-w-56">
            <DropdownMenuGroup>
              <DropdownMenuLabel className="flex items-center gap-2 p-1.5 font-normal text-foreground">
                {identity}
              </DropdownMenuLabel>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuLabel>Theme</DropdownMenuLabel>
              <DropdownMenuRadioGroup value={theme ?? 'system'} onValueChange={setTheme}>
                <DropdownMenuRadioItem value="light">
                  <SunIcon />
                  Light
                </DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="dark">
                  <MoonIcon />
                  Dark
                </DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="system">
                  <MonitorIcon />
                  System
                </DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={signOut}>
              <LogOutIcon />
              Sign out
            </DropdownMenuItem>
            <VersionLabel enabled={superAdmin} />
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}

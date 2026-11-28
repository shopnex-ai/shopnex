import {
  ArrowLeftIcon,
  CheckIcon,
  ChevronsUpDownIcon,
  ExternalLinkIcon,
  LogOutIcon,
  MonitorIcon,
  MoonIcon,
  SearchIcon,
  SettingsIcon,
  StoreIcon,
  SunIcon,
} from 'lucide-react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { cn } from 'cn'
import { Link, useLocation, useRouteContext } from '@tanstack/react-router'
import { useTheme } from 'next-themes'
import { toast } from 'sonner'
import { GlobalSearch } from '@/components/admin/global-search'
import { nav, settingsNav, type ExternalNavItem, type NavItem } from '@/components/admin/nav'
import { ShopnexBadge } from '@/components/admin/shopnex-logo'
import { UpdateMenuItem, VersionLabel } from '@/components/admin/update-notice'
import { useNavFilter } from '@/components/admin/use-nav-filter'
import { useSignOut } from '@/components/auth/sign-out-button'
import { AppIcon } from '@/screens/apps/installed-apps-card'
import { orpc } from '@/lib/orpc'
import { getSwitchableShops, switchShop } from '@/lib/session.functions'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Input } from '@/components/ui/input'
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
  SidebarTrigger,
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

/** True while a scrolling element has more below what is in view: a hint that the list goes on */
function useMoreBelow(ref: React.RefObject<HTMLElement | null>, key: unknown) {
  const [more, setMore] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const update = () => setMore(el.scrollHeight - el.scrollTop - el.clientHeight > 4)
    update()
    el.addEventListener('scroll', update, { passive: true })
    const observer = new ResizeObserver(update)
    observer.observe(el)
    return () => {
      el.removeEventListener('scroll', update)
      observer.disconnect()
    }
  }, [ref, key])
  return more
}

export function AppSidebar({ shop, user }: { shop: SidebarShop; user: SidebarUser }) {
  const inSettings = useLocation({
    select: (location) => location.pathname === '/admin/settings' || location.pathname.startsWith('/admin/settings/'),
  })
  const content = useRef<HTMLDivElement>(null)
  const moreBelow = useMoreBelow(content, inSettings)
  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        {/* The toggle sits at the end of the header row; in the collapsed rail it goes under the logo */}
        <div className="flex items-center gap-1 group-data-[collapsible=icon]:flex-col">
          <div className="min-w-0 flex-1 group-data-[collapsible=icon]:flex-none">
            {inSettings ? <SettingsHeader /> : <ShopIdentity shop={shop} />}
          </div>
          {/* Below md the sidebar is a sheet that the top bar opens, so there is no toggle here */}
          <SidebarTrigger className="hidden shrink-0 md:inline-flex" />
        </div>
      </SidebarHeader>
      <SidebarContent
        ref={content}
        className={cn(moreBelow && '[mask-image:linear-gradient(to_bottom,black_calc(100%-64px),transparent)]')}
      >
        <SidebarGroup className="pb-0">
          <SidebarMenu>
            <GlobalSearch superAdmin={shop.superAdmin} canManageApps={shop.canManageApps} />
          </SidebarMenu>
        </SidebarGroup>
        {(inSettings ? settingsNav : nav).map((group) => (
          <NavGroup key={group.label} {...group} canManageApps={shop.canManageApps} superAdmin={shop.superAdmin} />
        ))}
        <SidebarGroup className="mt-auto pb-0">
          <SidebarMenu>
            {!inSettings && (
              <SidebarMenuItem>
                <SidebarMenuButton render={<Link to="/admin/settings" />} tooltip="Settings">
                  <SettingsIcon />
                  <span>Settings</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            )}
            <UpdateMenuItem enabled={shop.superAdmin} />
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className={cn('border-t border-transparent pt-1', moreBelow && 'border-foreground/15')}>
        <UserMenu user={user} superAdmin={shop.superAdmin} />
      </SidebarFooter>
    </Sidebar>
  )
}

// With more shops than this the switcher gets a search box (the list holds 100 at most, so the rest are found by it)
const SEARCH_FROM = 8

// Single mode (or one shop): just the name. Multi mode with several shops: a switcher. The page reloads after a
// switch so nothing cached for the previous shop survives.
function ShopIdentity({ shop }: { shop: SidebarShop }) {
  const { isMobile } = useSidebar()
  const [search, setSearch] = useState('')
  const [term, setTerm] = useState('')
  const { data: all = [] } = useQuery({
    queryKey: ['switchable-shops'],
    queryFn: () => getSwitchableShops({ data: undefined }),
  })
  // Typing waits for a pause before asking the server; the previous result stays until the new one arrives
  useEffect(() => {
    const timer = setTimeout(() => setTerm(search.trim()), 250)
    return () => clearTimeout(timer)
  }, [search])
  const { data: found } = useQuery({
    queryKey: ['switchable-shops', term],
    queryFn: () => getSwitchableShops({ data: term }),
    enabled: term !== '',
    placeholderData: keepPreviousData,
  })
  const shops = term ? (found ?? []) : all
  const switchable = all.length > 1 || (shop.superAdmin && all.length > 0)
  const searchable = all.length > SEARCH_FROM

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
        <DropdownMenu onOpenChange={(open) => !open && setSearch('')}>
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
            {searchable && (
              <div className="sticky top-0 z-10 -mx-1 -mt-1 bg-popover p-2 pb-2.5">
                <div className="relative">
                  <SearchIcon className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    // Typing in a menu would otherwise jump to items by their first letter (and a space would pick one)
                    onKeyDown={(e) => {
                      if (
                        e.key.length === 1 ||
                        ['Backspace', 'Delete', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)
                      )
                        e.stopPropagation()
                    }}
                    placeholder="Search shops…"
                    aria-label="Search shops"
                    autoFocus
                    className="h-8 pl-7 text-sm"
                  />
                </div>
              </div>
            )}
            <DropdownMenuGroup>
              {term && shops.length === 0 && (
                <p className="px-2 py-1.5 text-sm text-muted-foreground">No shops match “{term}”.</p>
              )}
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
  const visible = items.filter(useNavFilter(superAdmin))
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
                  item.children
                    ? inGroup(item, pathname) && !item.children.some((c) => onPage(c.href, pathname))
                    : item.exact
                      ? pathname === item.href
                      : pathname === item.href || pathname.startsWith(`${item.href}/`)
                }
                tooltip={item.label}
              >
                <item.icon />
                <span>{item.label}</span>
              </SidebarMenuButton>
              {item.children && <NavChildren parent={item} pathname={pathname} />}
              {canManageApps && item.href === '/admin/apps' && <InstalledApps />}
            </SidebarMenuItem>
          ),
        )}
      </SidebarMenu>
    </SidebarGroup>
  )
}

const onPage = (href: string, pathname: string) => pathname === href || pathname.startsWith(`${href}/`)
const inGroup = (item: NavItem, pathname: string) => onPage(item.href, pathname)

// The pages that belong to an item (Online store: Pages, Navigation), shown while you are in the item or one of them.
// The item itself is highlighted on its own pages, a child on its own.
function NavChildren({ parent, pathname }: { parent: NavItem; pathname: string }) {
  const { isMobile, setOpenMobile } = useSidebar()
  if (!inGroup(parent, pathname)) return null
  return (
    <SidebarMenuSub>
      {(parent.children ?? []).map((c) => (
        <SidebarMenuSubItem key={c.label}>
          <SidebarMenuSubButton
            render={<Link to={c.href} onClick={() => isMobile && setOpenMobile(false)} />}
            isActive={onPage(c.href, pathname)}
          >
            <span>{c.label}</span>
          </SidebarMenuSubButton>
        </SidebarMenuSubItem>
      ))}
    </SidebarMenuSub>
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
  // Shown with a capital first letter (people sign up as "demo"); an email is shown as it is
  const label = user.name ? user.name.charAt(0).toUpperCase() + user.name.slice(1) : user.email

  const identity = (
    <>
      <Avatar className="size-8 rounded-lg after:rounded-lg">
        {user.image && <AvatarImage src={user.image} alt="" className="rounded-lg" />}
        <AvatarFallback className="rounded-lg">{fallback}</AvatarFallback>
      </Avatar>
      <div className="grid flex-1 text-left text-sm leading-tight">
        <span className="truncate font-medium">{label}</span>
        {user.name && <span className="truncate text-xs text-muted-foreground">{user.email}</span>}
      </div>
    </>
  )

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          {/* A row like the nav items: the email is in the menu it opens */}
          <DropdownMenuTrigger render={<SidebarMenuButton className="data-popup-open:bg-sidebar-accent" />}>
            <Avatar className="size-4 rounded-[3px] after:rounded-[3px]">
              {user.image && <AvatarImage src={user.image} alt="" className="rounded-[3px]" />}
              <AvatarFallback className="rounded-[3px] text-[9px]">{fallback}</AvatarFallback>
            </Avatar>
            <span className="truncate">{label}</span>
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

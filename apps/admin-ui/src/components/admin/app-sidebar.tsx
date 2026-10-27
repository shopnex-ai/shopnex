'use client'

import {
  ArrowLeftIcon,
  BellIcon,
  BlocksIcon,
  BookOpenIcon,
  ChevronsUpDownIcon,
  CodeIcon,
  CreditCardIcon,
  ExternalLinkIcon,
  LayersIcon,
  HardDriveIcon,
  HouseIcon,
  KeyRoundIcon,
  LogOutIcon,
  MailIcon,
  MenuIcon,
  NotebookTextIcon,
  MonitorIcon,
  MoonIcon,
  PackageIcon,
  PercentIcon,
  SettingsIcon,
  Share2Icon,
  StoreIcon,
  ShoppingCartIcon,
  SunIcon,
  TicketPercentIcon,
  TruckIcon,
  UserCogIcon,
  UsersIcon,
  WebhookIcon,
  type LucideIcon,
} from 'lucide-react'
import { Link, useLocation, type ToOptions } from '@tanstack/react-router'
import { useTheme } from 'next-themes'
import { ShopnexBadge } from '@/components/admin/shopnex-logo'
import { useSignOut } from '@/components/auth/sign-out-button'
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
  useSidebar,
} from '@/components/ui/sidebar'

type NavItem = {
  href: NonNullable<ToOptions['to']>
  label: string
  icon: LucideIcon
  /** Only this exact path is active */ exact?: boolean
}

// Add screens here as they're built
const nav: { label: string; items: NavItem[] }[] = [
  {
    label: 'Store',
    items: [
      { href: '/admin', label: 'Home', icon: HouseIcon, exact: true },
      { href: '/admin/orders', label: 'Orders', icon: ShoppingCartIcon },
      { href: '/admin/products', label: 'Products', icon: PackageIcon },
      { href: '/admin/collections', label: 'Collections', icon: LayersIcon },
      { href: '/admin/customers', label: 'Customers', icon: UsersIcon },
      { href: '/admin/discounts', label: 'Discounts', icon: TicketPercentIcon },
      // Theme library and editor; Pages and Navigation are their own entries
      { href: '/admin/online-store/themes', label: 'Online store', icon: StoreIcon },
      { href: '/admin/online-store/pages', label: 'Pages', icon: NotebookTextIcon },
      { href: '/admin/online-store/navigation', label: 'Navigation', icon: MenuIcon },
      { href: '/admin/apps', label: 'Apps', icon: BlocksIcon },
    ],
  },
]

// Under /admin/settings the sidebar shows these instead of the main nav, one page each
const settingsNav: { label: string; items: NavItem[] }[] = [
  {
    label: 'Shop',
    items: [
      { href: '/admin/settings/general', label: 'General', icon: StoreIcon },
      { href: '/admin/settings/staff', label: 'Staff', icon: UserCogIcon },
    ],
  },
  {
    label: 'Checkout',
    items: [
      { href: '/admin/settings/payments', label: 'Payments', icon: CreditCardIcon },
      { href: '/admin/settings/shipping', label: 'Shipping', icon: TruckIcon },
      { href: '/admin/settings/taxes', label: 'Taxes', icon: PercentIcon },
    ],
  },
  {
    label: 'Files',
    items: [{ href: '/admin/settings/storage', label: 'Storage', icon: HardDriveIcon }],
  },
  {
    label: 'Email',
    items: [
      { href: '/admin/settings/email', label: 'Sending', icon: MailIcon },
      { href: '/admin/settings/notifications', label: 'Notifications', icon: BellIcon },
    ],
  },
  {
    label: 'Developers',
    items: [
      { href: '/admin/settings/channels', label: 'Sales channels', icon: Share2Icon },
      { href: '/admin/settings/storefront-keys', label: 'Storefront keys', icon: KeyRoundIcon },
      { href: '/admin/settings/api-tokens', label: 'API tokens', icon: CodeIcon },
      { href: '/admin/settings/webhooks', label: 'Webhooks', icon: WebhookIcon },
    ],
  },
]

export type SidebarShop = { name: string; superAdmin: boolean }
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
        {(inSettings ? settingsNav : nav).map((group) => (
          <NavGroup key={group.label} {...group} />
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
            <SidebarMenuItem>
              {/* Served by the API (oRPC OpenAPI reference), not a Next page: open in a new tab */}
              <SidebarMenuButton
                render={<a href="/api/v1/docs" target="_blank" rel="noopener" />}
                tooltip="API reference"
                size="sm"
              >
                <BookOpenIcon />
                <span>API reference</span>
                <ExternalLinkIcon className="ml-auto opacity-50" />
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <UserMenu user={user} />
      </SidebarFooter>
    </Sidebar>
  )
}

// Multi-tenant mode: becomes a shop switcher (authClient.organization.setActive)
function ShopIdentity({ shop }: { shop: SidebarShop }) {
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <SidebarMenuButton size="lg" render={<Link to="/admin" />} tooltip={shop.name}>
          <ShopnexBadge />
          <div className="grid flex-1 text-left leading-tight">
            <span className="truncate font-semibold">{shop.name}</span>
            <span className="truncate text-xs text-muted-foreground">
              {shop.superAdmin ? 'Super admin' : 'Shopnex Admin'}
            </span>
          </div>
        </SidebarMenuButton>
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

function NavGroup({ label, items }: { label: string; items: NavItem[] }) {
  const pathname = useLocation({ select: (location) => location.pathname })
  const { isMobile, setOpenMobile } = useSidebar()
  return (
    <SidebarGroup>
      <SidebarGroupLabel>{label}</SidebarGroupLabel>
      <SidebarMenu>
        {items.map(({ href, label, icon: Icon, exact }) => (
          <SidebarMenuItem key={href}>
            <SidebarMenuButton
              render={<Link to={href} onClick={() => isMobile && setOpenMobile(false)} />}
              isActive={exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`)}
              tooltip={label}
            >
              <Icon />
              <span>{label}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        ))}
      </SidebarMenu>
    </SidebarGroup>
  )
}

function UserMenu({ user }: { user: SidebarUser }) {
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
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}

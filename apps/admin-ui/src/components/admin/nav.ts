import type { ToOptions } from '@tanstack/react-router'
import {
  BellIcon,
  BlocksIcon,
  CodeIcon,
  CreditCardIcon,
  GlobeIcon,
  HardDriveIcon,
  HouseIcon,
  KeyRoundIcon,
  LayersIcon,
  MailIcon,
  MenuIcon,
  NotebookTextIcon,
  PackageIcon,
  PercentIcon,
  Share2Icon,
  ShoppingCartIcon,
  StoreIcon,
  TicketPercentIcon,
  TruckIcon,
  UserCogIcon,
  UsersIcon,
  WebhookIcon,
  type LucideIcon,
} from 'lucide-react'

export type NavItem = {
  href: NonNullable<ToOptions['to']>
  label: string
  icon: LucideIcon
  /** Only this exact path is active */ exact?: boolean
  /** Hidden from everyone else */ superAdminOnly?: boolean
}

// Add screens here as they're built
export const nav: { label: string; items: NavItem[] }[] = [
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
      { href: '/admin/apps', label: 'Apps', icon: BlocksIcon, exact: true },
    ],
  },
]

// Under /admin/settings the sidebar shows these instead of the main nav, one page each
export const settingsNav: { label: string; items: NavItem[] }[] = [
  {
    label: 'Shop',
    items: [
      { href: '/admin/settings/general', label: 'General', icon: StoreIcon },
      { href: '/admin/settings/staff', label: 'Staff', icon: UserCogIcon },
      { href: '/admin/settings/domains', label: 'Domains', icon: GlobeIcon },
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
      { href: '/admin/settings/marketplace', label: 'Marketplace', icon: BlocksIcon, superAdminOnly: true },
      { href: '/admin/settings/storefront-keys', label: 'Storefront keys', icon: KeyRoundIcon },
      { href: '/admin/settings/api-tokens', label: 'API tokens', icon: CodeIcon },
      { href: '/admin/settings/webhooks', label: 'Webhooks', icon: WebhookIcon },
    ],
  },
]

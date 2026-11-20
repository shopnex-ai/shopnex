import type { ToOptions } from '@tanstack/react-router'
import {
  BellIcon,
  BlocksIcon,
  BookOpenIcon,
  CodeIcon,
  CreditCardIcon,
  GlobeIcon,
  LanguagesIcon,
  HardDriveIcon,
  HouseIcon,
  KeyRoundIcon,
  LayersIcon,
  MailIcon,
  MenuIcon,
  NotebookTextIcon,
  PackageIcon,
  PercentIcon,
  ServerIcon,
  Share2Icon,
  ShoppingCartIcon,
  SparklesIcon,
  StoreIcon,
  GiftIcon,
  TicketPercentIcon,
  TruckIcon,
  UserCogIcon,
  UsersIcon,
  WebhookIcon,
  type LucideIcon,
  ListPlusIcon,
} from 'lucide-react'

export type NavItem = {
  href: NonNullable<ToOptions['to']>
  label: string
  icon: LucideIcon
  /** Only this exact path is active */ exact?: boolean
  /** Hidden from everyone else */ superAdminOnly?: boolean
  /** Hidden until the shop has published another language */ needsLanguage?: boolean
  /** Pages that belong to this one: shown under it while you are in it or in any of them */
  children?: NavChild[]
  external?: undefined
}

export type NavChild = {
  href: NonNullable<ToOptions['to']>
  label: string
  icon: LucideIcon
}

// A link to a page the API serves (not an admin route): opens in a new tab
export type ExternalNavItem = {
  href: string
  label: string
  icon: LucideIcon
  external: true
  superAdminOnly?: boolean
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
      { href: '/admin/gift-cards', label: 'Gift cards', icon: GiftIcon },
      {
        href: '/admin/online-store',
        label: 'Online store',
        icon: StoreIcon,
        // The item itself is the theme page (with the picker and editor); these are its other pages
        children: [
          { href: '/admin/online-store/pages', label: 'Pages', icon: NotebookTextIcon },
          { href: '/admin/online-store/navigation', label: 'Navigation', icon: MenuIcon },
        ],
      },
      { href: '/admin/translations', label: 'Translations', icon: LanguagesIcon, needsLanguage: true },
      { href: '/admin/apps', label: 'Apps', icon: BlocksIcon, exact: true },
    ],
  },
  {
    label: 'Platform',
    items: [{ href: '/admin/platform', label: 'Shops & users', icon: ServerIcon, superAdminOnly: true }],
  },
]

// Under /admin/settings the sidebar shows these instead of the main nav, one page each
export const settingsNav: { label: string; items: (NavItem | ExternalNavItem)[] }[] = [
  {
    label: 'Shop',
    items: [
      { href: '/admin/settings/general', label: 'General', icon: StoreIcon },
      { href: '/admin/settings/staff', label: 'Staff', icon: UserCogIcon },
      { href: '/admin/settings/ai', label: 'AI', icon: SparklesIcon },
      { href: '/admin/settings/domains', label: 'Domains', icon: GlobeIcon },
      { href: '/admin/settings/languages', label: 'Languages', icon: LanguagesIcon },
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
      { href: '/admin/settings/custom-fields', label: 'Custom fields', icon: ListPlusIcon },
      { href: '/admin/settings/channels', label: 'Sales channels', icon: Share2Icon },
      { href: '/admin/settings/marketplace', label: 'Marketplace', icon: BlocksIcon, superAdminOnly: true },
      { href: '/admin/settings/storefront-keys', label: 'Storefront keys', icon: KeyRoundIcon },
      { href: '/admin/settings/api-tokens', label: 'API tokens', icon: CodeIcon },
      { href: '/admin/settings/webhooks', label: 'Webhooks', icon: WebhookIcon },
      { href: '/api/v1/docs', label: 'API reference', icon: BookOpenIcon, external: true },
    ],
  },
]

'use client'

import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import {
  BookOpenIcon,
  LayersIcon,
  LogOutIcon,
  PackageIcon,
  SearchIcon,
  ShoppingCartIcon,
  UserIcon,
  TicketPercentIcon,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { nav, settingsNav, type NavItem } from '@/components/admin/nav'
import { SidebarMenuButton, SidebarMenuItem } from '@/components/ui/sidebar'
import { useSignOut } from '@/components/auth/sign-out-button'
import { orderName } from '@/lib/format'
import { AppIcon } from '@/screens/apps/installed-apps-card'
import { orpc } from '@/lib/orpc'

const LIMIT = 5

// Creation shortcuts; the list pages open their create dialog on ?new=1
const ACTIONS = [
  { href: '/admin/products', label: 'New product', icon: PackageIcon, search: { new: 1 } },
  { href: '/admin/discounts', label: 'New discount', icon: TicketPercentIcon, search: { new: 1 } },
  { href: '/admin/collections/new', label: 'New collection', icon: LayersIcon },
] as const

const matches = (label: string, query: string) => label.toLowerCase().includes(query.toLowerCase())

// Search across products, orders and customers; opens with ⌘K / Ctrl+K
export function GlobalSearch({ superAdmin, canManageApps }: { superAdmin: boolean; canManageApps: boolean }) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState('')
  const [search, setSearch] = useState('')
  const navigate = useNavigate()
  const signOut = useSignOut()

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        setOpen((o) => !o)
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [])

  useEffect(() => {
    const timer = setTimeout(() => setSearch(draft.trim()), 250)
    return () => clearTimeout(timer)
  }, [draft])

  // A staff member without a scope gets an error for that group; it just stays empty
  const options = { enabled: open && search.length > 0, placeholderData: keepPreviousData, retry: false }
  const products = useQuery({
    ...orpc.admin.products.list.queryOptions({ input: { search, limit: LIMIT } }),
    ...options,
  })
  const orders = useQuery({ ...orpc.admin.orders.list.queryOptions({ input: { search, limit: LIMIT } }), ...options })
  const customers = useQuery({
    ...orpc.admin.customers.list.queryOptions({ input: { search, limit: LIMIT } }),
    ...options,
  })

  // keepPreviousData would otherwise keep showing the last search's results under an empty box
  // Same list as the sidebar (shared cache); installed apps are only for those who manage apps
  const apps = useQuery({ ...orpc.admin.apps.list.queryOptions(), enabled: open && canManageApps })
  const appItems = search ? (apps.data ?? []).filter((i) => matches(i.app.name, search)) : []

  const productItems = (search && products.data?.items) || []
  const orderItems = (search && orders.data?.items) || []
  const customerItems = (search && customers.data?.items) || []
  const visible = (items: NavItem[]) => items.filter((i) => !i.superAdminOnly || superAdmin)
  // Pages, settings and actions appear once you type; the box starts empty
  const pages = search ? visible(nav.flatMap((g) => g.items)).filter((i) => matches(i.label, search)) : []
  // Settings pages would crowd the empty state; they show once there is a query
  const settings = search ? visible(settingsNav.flatMap((g) => g.items)).filter((i) => matches(i.label, search)) : []
  const general = [
    {
      label: 'API reference',
      icon: BookOpenIcon,
      // Served by the API, not an admin page: open it in a new tab like the sidebar link does
      run: () => window.open('/api/v1/docs', '_blank', 'noopener'),
    },
    { label: 'Sign out', icon: LogOutIcon, run: () => void signOut() },
  ].filter((g) => search && matches(g.label, search))
  const actions = search ? ACTIONS.filter((a) => matches(a.label, search)) : []
  const staticCount = pages.length + settings.length + actions.length + general.length + appItems.length
  const searching = search.length > 0 && (products.isFetching || orders.isFetching || customers.isFetching)

  const close = (next: boolean) => {
    setOpen(next)
    if (!next) {
      setDraft('')
      setSearch('')
    }
  }
  const go = (to: '/admin/products/$id' | '/admin/orders/$id' | '/admin/customers/$id', id: string) => {
    close(false)
    void navigate({ to, params: { id } })
  }
  const goToApp = (id: string) => {
    close(false)
    void navigate({ to: '/admin/apps/$id', params: { id } })
  }
  const goTo = (to: NavItem['href'], search?: Record<string, unknown>) => {
    close(false)
    void navigate({ to, search })
  }

  return (
    <>
      <SidebarMenuItem>
        <SidebarMenuButton
          tooltip="Search"
          onClick={() => setOpen(true)}
          className="bg-card text-muted-foreground shadow-field hover:bg-card hover:text-foreground"
        >
          <SearchIcon />
          <span>Search</span>
          <kbd className="ml-auto rounded border px-1 text-xs">⌘K</kbd>
        </SidebarMenuButton>
      </SidebarMenuItem>
      <CommandDialog
        open={open}
        onOpenChange={close}
        shouldFilter={false}
        title="Search"
        description="Search products, orders and customers"
      >
        <CommandInput value={draft} onValueChange={setDraft} placeholder="Search products, orders, customers…" />
        <CommandList>
          {staticCount === 0 && !searching && productItems.length + orderItems.length + customerItems.length === 0 && (
            <CommandEmpty>
              {search ? `No results for “${search}”.` : 'Search products, orders, customers or pages'}
            </CommandEmpty>
          )}
          {actions.length > 0 && (
            <CommandGroup heading="Actions">
              {actions.map((a) => (
                <CommandItem
                  key={a.label}
                  value={`action-${a.label}`}
                  onSelect={() => goTo(a.href, 'search' in a ? a.search : undefined)}
                >
                  <a.icon />
                  <span>{a.label}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          )}
          {general.length > 0 && (
            <CommandGroup heading="General">
              {general.map(({ label, icon: Icon, run }) => (
                <CommandItem
                  key={label}
                  value={`general-${label}`}
                  onSelect={() => {
                    close(false)
                    run()
                  }}
                >
                  <Icon />
                  <span>{label}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          )}
          {pages.length > 0 && (
            <CommandGroup heading="Pages">
              {pages.map(({ href, label, icon: Icon }) => (
                <CommandItem key={href} value={`page-${href}`} onSelect={() => goTo(href)}>
                  <Icon />
                  <span>{label}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          )}
          {settings.length > 0 && (
            <CommandGroup heading="Settings">
              {settings.map(({ href, label, icon: Icon }) => (
                <CommandItem key={href} value={`setting-${href}`} onSelect={() => goTo(href)}>
                  <Icon />
                  <span>{label}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          )}
          {appItems.length > 0 && (
            <CommandGroup heading="Apps">
              {appItems.map((i) => (
                <CommandItem key={i.id} value={`app-${i.id}`} onSelect={() => goToApp(i.id)}>
                  <AppIcon url={i.app.iconUrl} className="size-4 rounded-sm" />
                  <span className="truncate">{i.app.name}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          )}
          {productItems.length > 0 && (
            <CommandGroup heading="Products">
              {productItems.map((p) => (
                <CommandItem key={p.id} value={`product-${p.id}`} onSelect={() => go('/admin/products/$id', p.id)}>
                  <PackageIcon />
                  <span className="truncate">{p.title}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          )}
          {orderItems.length > 0 && (
            <CommandGroup heading="Orders">
              {orderItems.map((o) => (
                <CommandItem key={o.id} value={`order-${o.id}`} onSelect={() => go('/admin/orders/$id', o.id)}>
                  <ShoppingCartIcon />
                  <span>{orderName(o.orderNumber)}</span>
                  <span className="truncate text-muted-foreground">{o.customerName ?? o.email}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          )}
          {customerItems.length > 0 && (
            <CommandGroup heading="Customers">
              {customerItems.map((c) => (
                <CommandItem key={c.id} value={`customer-${c.id}`} onSelect={() => go('/admin/customers/$id', c.id)}>
                  <UserIcon />
                  <span className="truncate">{c.name ?? c.email}</span>
                  {c.name && <span className="truncate text-muted-foreground">{c.email}</span>}
                </CommandItem>
              ))}
            </CommandGroup>
          )}
        </CommandList>
      </CommandDialog>
    </>
  )
}

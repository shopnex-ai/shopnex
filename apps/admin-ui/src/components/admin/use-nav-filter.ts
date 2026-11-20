import { useQuery } from '@tanstack/react-query'
import { orpc } from '@/lib/orpc'
import type { ExternalNavItem, NavItem } from '@/components/admin/nav'

/**
 * Which nav items to show: not the super admin ones to everyone else, and not the ones that need another language (Translations)
 * until the shop has published one. The sidebar and the ⌘K search both use it.
 */
export function useNavFilter(superAdmin: boolean) {
  const languages = useQuery({ ...orpc.admin.languages.list.queryOptions(), staleTime: 60_000 })
  const hasLanguage = (languages.data?.languages.length ?? 0) > 0
  return (item: NavItem | ExternalNavItem) =>
    (!item.superAdminOnly || superAdmin) && (item.external || !item.needsLanguage || hasLanguage)
}

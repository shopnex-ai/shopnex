import { createFileRoute } from '@tanstack/react-router'
import { NotFound } from '@/components/not-found'
import { ThemeCodePage } from '@/screens/online-store/themes/theme-code-page'
import { loadThemeCode } from '@/screens/online-store/themes/theme-functions'

export const Route = createFileRoute('/admin/online-store/editor/$id_/code')({
  staticData: { collapseSidebar: true },
  notFoundComponent: () => (
    <NotFound
      title="Theme not found"
      message="It may have been deleted, or it belongs to another shop."
      back={{ to: '/admin/online-store', label: 'Online store' }}
    />
  ),
  loader: ({ params }) => loadThemeCode({ data: { id: params.id } }),
  component: ThemeCodePage,
})

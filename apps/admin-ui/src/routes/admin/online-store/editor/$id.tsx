import { createFileRoute } from '@tanstack/react-router'
import { NotFound } from '@/components/not-found'
import { ThemeEditorPage } from '@/screens/online-store/themes/theme-editor-page'
import { loadThemeEditor } from '@/screens/online-store/themes/theme-functions'

export const Route = createFileRoute('/admin/online-store/editor/$id')({
  staticData: { collapseSidebar: true },
  notFoundComponent: () => (
    <NotFound
      title="Theme not found"
      message="It may have been deleted, or it belongs to another shop."
      back={{ to: '/admin/online-store', label: 'Online store' }}
    />
  ),
  loader: ({ params }) => loadThemeEditor({ data: { id: params.id } }),
  component: ThemeEditorPage,
})

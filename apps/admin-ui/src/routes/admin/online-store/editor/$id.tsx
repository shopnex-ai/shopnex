import { createFileRoute } from '@tanstack/react-router'
import { ThemeEditorPage } from '@/screens/online-store/themes/theme-editor-page'
import { loadThemeEditor } from '@/screens/online-store/themes/theme-functions'

export const Route = createFileRoute('/admin/online-store/editor/$id')({
  staticData: { collapseSidebar: true },
  loader: ({ params }) => loadThemeEditor({ data: { id: params.id } }),
  component: ThemeEditorPage,
})

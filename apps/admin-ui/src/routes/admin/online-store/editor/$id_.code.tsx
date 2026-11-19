import { createFileRoute } from '@tanstack/react-router'
import { ThemeCodePage } from '@/screens/online-store/themes/theme-code-page'
import { loadThemeCode } from '@/screens/online-store/themes/theme-functions'

export const Route = createFileRoute('/admin/online-store/editor/$id_/code')({
  loader: ({ params }) => loadThemeCode({ data: { id: params.id } }),
  component: ThemeCodePage,
})

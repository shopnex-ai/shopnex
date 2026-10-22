import { createFileRoute } from '@tanstack/react-router'
import { ThemeEditorPage } from '@/screens/online-store/themes/theme-editor-page'
import { loadThemeEditor } from '@/screens/online-store/themes/theme-functions'

export const Route = createFileRoute('/admin/online-store/themes/$id')({
  loader: ({ params, context }) =>
    loadThemeEditor({
      data: { id: params.id, storefrontUrl: context.access.tenant?.shop.storefrontUrl ?? null },
    }),
  component: ThemeEditorPage,
})

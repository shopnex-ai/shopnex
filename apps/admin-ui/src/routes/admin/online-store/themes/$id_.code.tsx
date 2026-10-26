import { createFileRoute } from '@tanstack/react-router'
import { ThemeCodePage } from '@/screens/online-store/themes/theme-code-page'
import { loadThemeCode } from '@/screens/online-store/themes/theme-functions'

export const Route = createFileRoute('/admin/online-store/themes/$id_/code')({
  loader: ({ params, context }) =>
    loadThemeCode({
      data: { id: params.id, storefrontUrl: context.access.tenant?.shop.storefrontUrl ?? null },
    }),
  component: ThemeCodePage,
})

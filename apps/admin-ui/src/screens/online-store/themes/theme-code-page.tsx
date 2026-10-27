import { useLoaderData, useRouteContext } from '@tanstack/react-router'
import { ThemeCode } from './[id]/code/theme-code'

export function ThemeCodePage() {
  const { previewCatalog, definition, ...theme } = useLoaderData({ from: '/admin/online-store/themes/$id_/code' })
  const storefrontUrl = useRouteContext({
    from: '/admin/online-store/themes/$id_/code',
    select: (context) => context.access.tenant?.shop.storefrontUrl ?? null,
  })
  return (
    <ThemeCode
      key={theme.id}
      storefrontUrl={storefrontUrl}
      pages={theme.pages}
      previewCatalog={previewCatalog}
      definition={definition}
      theme={{ id: theme.id, name: theme.name, live: theme.role === 'live' }}
    />
  )
}

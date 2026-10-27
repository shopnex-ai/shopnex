import { useLoaderData } from '@tanstack/react-router'
import { Link } from '@tanstack/react-router'
import { ThemesProblem } from './definition'
import { ThemeEditor } from './[id]/theme-editor'

export function ThemeEditorPage() {
  const { theme, storefront, definition, previewCatalog } = useLoaderData({ from: '/admin/online-store/themes/$id' })
  if (!definition) {
    return (
      <ThemesProblem>
        {storefront.storefrontError ?? (
          <>
            <strong>{theme.name}</strong> is a copy of a theme this storefront does not include, so it cannot be edited.{' '}
            <Link to="/admin/online-store/themes" className="underline">
              Back to themes
            </Link>
          </>
        )}
      </ThemesProblem>
    )
  }
  return (
    <ThemeEditor
      key={theme.id}
      definition={definition}
      previewCatalog={previewCatalog}
      storefrontUrl={storefront.storefront?.url ?? ''}
      theme={{ id: theme.id, name: theme.name, live: theme.role === 'live', codeUnpublished: theme.codeUnpublished }}
      initialDraft={theme.draft}
      initialPublished={theme.published}
    />
  )
}

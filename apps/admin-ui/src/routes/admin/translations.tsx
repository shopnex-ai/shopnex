import { createFileRoute } from '@tanstack/react-router'
import { TranslationWorkspace, type WorkspaceSearch } from '@/screens/translations/translation-workspace'

export const Route = createFileRoute('/admin/translations')({
  // Which language, kind of record and record are open, so a link (from a record's own page) opens straight to it
  validateSearch: (search: Record<string, unknown>): WorkspaceSearch => ({
    resource:
      search.resource === 'product' || search.resource === 'collection' || search.resource === 'page'
        ? search.resource
        : undefined,
    id: typeof search.id === 'string' ? search.id : undefined,
    language: typeof search.language === 'string' ? search.language : undefined,
  }),
  component: TranslationsPage,
})

function TranslationsPage() {
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  return (
    <TranslationWorkspace
      search={search}
      onChange={(patch) => void navigate({ search: (s) => ({ ...s, ...patch }) })}
    />
  )
}

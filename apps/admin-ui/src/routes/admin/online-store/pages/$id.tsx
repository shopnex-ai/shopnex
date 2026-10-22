import { createFileRoute } from '@tanstack/react-router'
import { PageEditor } from '@/screens/online-store/pages/[id]/page-editor'

export const Route = createFileRoute('/admin/online-store/pages/$id')({ component: PageEditorRoute })
function PageEditorRoute() {
  const { id } = Route.useParams()
  return (
    <div className="mx-auto max-w-5xl">
      <PageEditor id={id === 'new' ? null : id} />
    </div>
  )
}

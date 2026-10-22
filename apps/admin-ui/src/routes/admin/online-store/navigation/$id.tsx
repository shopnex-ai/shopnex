import { createFileRoute } from '@tanstack/react-router'
import { MenuEditor } from '@/screens/online-store/navigation/[id]/menu-editor'

export const Route = createFileRoute('/admin/online-store/navigation/$id')({ component: MenuEditorRoute })
function MenuEditorRoute() {
  const { id } = Route.useParams()
  return (
    <div className="mx-auto max-w-4xl">
      <MenuEditor id={id} />
    </div>
  )
}

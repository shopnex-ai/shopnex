import { createFileRoute } from '@tanstack/react-router'
import { NoAccess } from '@/components/admin/no-access'
import { managerAccess } from '@/lib/admin-access'
import { Skeleton } from '@/components/ui/skeleton'
import { EmbeddedApp } from '@/screens/apps/[id]/embedded-app'
import { getEmbeddedApp } from '@/screens/apps/functions'

export const Route = createFileRoute('/admin/apps/$id')({
  loader: ({ params, context }) => {
    // The server function enforces this too; the check here is for the page to show a message, not an error
    const access = managerAccess(context.access)
    if (access.status === 'none') return null
    if (access.status === 'forbidden') return { forbidden: true as const }
    return getEmbeddedApp({ data: { id: params.id } })
  },
  pendingMs: 0,
  pendingComponent: () => <Skeleton className="h-[calc(100svh-8rem)] w-full" />,
  component: EmbeddedAppPage,
})
function EmbeddedAppPage() {
  const result = Route.useLoaderData()
  if (!result) return null
  if ('forbidden' in result) return <NoAccess message="Only shop owners and admins can use apps." />
  if (!result) return <p>App installation not found.</p>
  return (
    <EmbeddedApp
      installationId={result.installation.id}
      src={result.src}
      name={result.installation.app.name}
      iconUrl={result.installation.app.iconUrl}
    />
  )
}

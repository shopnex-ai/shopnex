import { createFileRoute } from '@tanstack/react-router'
import { NoAccess } from '@/components/admin/no-access'
import { managerAccess } from '@/lib/admin-access'
import { PreviewLoader } from '@/screens/online-store/themes/preview-loader'
import { EmbeddedApp } from '@/screens/apps/[id]/embedded-app'
import { getEmbeddedApp } from '@/screens/apps/functions'
import { NotFound } from '@/components/not-found'

export const Route = createFileRoute('/admin/apps/$id')({
  loader: ({ params, context }) => {
    // The server function enforces this too; the check here is for the page to show a message, not an error
    const access = managerAccess(context.access)
    if (access.status === 'none') return null
    if (access.status === 'forbidden') return { forbidden: true as const }
    return getEmbeddedApp({ data: { id: params.id } })
  },
  pendingMs: 0,
  pendingComponent: () => (
    <div className="relative h-[calc(100svh-8rem)] w-full">
      <PreviewLoader />
    </div>
  ),
  component: EmbeddedAppPage,
})
function EmbeddedAppPage() {
  const result = Route.useLoaderData()
  // Uninstalled, or an id that is not an installation of this shop
  if (!result) {
    return (
      <NotFound
        title="App not found"
        message="It may have been uninstalled."
        back={{ to: '/admin/apps', label: 'Apps' }}
      />
    )
  }
  if ('forbidden' in result) return <NoAccess message="Only shop owners and admins can use apps." />
  return (
    <EmbeddedApp
      installationId={result.installation.id}
      src={result.src}
      name={result.installation.app.name}
      iconUrl={result.installation.app.iconUrl}
    />
  )
}

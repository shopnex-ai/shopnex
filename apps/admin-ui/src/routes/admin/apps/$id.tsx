import { createFileRoute } from '@tanstack/react-router'
import { NoAccess } from '@/components/admin/no-access'
import { EmbeddedApp } from '@/screens/apps/[id]/embedded-app'
import { getEmbeddedApp } from '@/screens/apps/functions'

export const Route = createFileRoute('/admin/apps/$id')({
  loader: async ({ params, context }) => {
    const { tenant, session } = context.access
    if (!tenant || !session) return null
    if (!tenant.superAdmin && tenant.role !== 'owner' && tenant.role !== 'admin') return { forbidden: true as const }
    return getEmbeddedApp({ data: { id: params.id, shopId: tenant.shop.id, userId: session.user.id } })
  },
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

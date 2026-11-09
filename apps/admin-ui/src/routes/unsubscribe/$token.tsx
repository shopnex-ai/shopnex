import { createFileRoute } from '@tanstack/react-router'
import { UnsubscribePage } from '@/screens/unsubscribe/unsubscribe-page'
import { getUnsubscribe } from '@/screens/unsubscribe/functions'

export const Route = createFileRoute('/unsubscribe/$token')({
  loader: ({ params }) => getUnsubscribe({ data: params.token }),
  head: () => ({ meta: [{ title: 'Unsubscribe' }, { name: 'robots', content: 'noindex,nofollow' }] }),
  component: UnsubscribeRoute,
})

function UnsubscribeRoute() {
  const data = Route.useLoaderData()
  const { token } = Route.useParams()
  return data ? (
    <UnsubscribePage token={token} email={data.email} shopName={data.shopName} />
  ) : (
    <main className="mx-auto max-w-md p-10 text-center">This unsubscribe link is not valid.</main>
  )
}

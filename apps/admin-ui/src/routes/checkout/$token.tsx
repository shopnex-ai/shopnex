import { createFileRoute } from '@tanstack/react-router'
import { getCheckout } from '@/screens/checkout/functions'
import { CheckoutPage } from '@/screens/checkout/checkout-page'

export const Route = createFileRoute('/checkout/$token')({
  loader: ({ params }) => getCheckout({ data: params.token }),
  head: () => ({ meta: [{ title: 'Checkout' }, { name: 'robots', content: 'noindex,nofollow' }] }),
  component: CheckoutRoute,
})

function CheckoutRoute() {
  const data = Route.useLoaderData()
  return data ? (
    <CheckoutPage data={data} />
  ) : (
    <main className="mx-auto max-w-xl p-10 text-center">This checkout is no longer available.</main>
  )
}

import type { APIRoute } from 'astro'
import { endSession, tokenOf } from '../../core/account'
import { shopnexFor } from '../../core/shopnex'

// POST only (a link must not sign anyone out); Astro checks the form's origin
export const POST: APIRoute = async ({ cookies, redirect }) => {
  const token = tokenOf(cookies)
  if (token)
    await shopnexFor(token)
      .customer.signOut()
      .catch(() => {})
  endSession(cookies)
  return redirect('/')
}

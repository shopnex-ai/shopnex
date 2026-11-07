import { createMiddleware, createServerFn } from '@tanstack/react-start'
import { managerAccess } from './admin-access'

// Every server function is its own public HTTP endpoint (/_serverFn/…): a check in the page loader does not protect
// it. So this is the only place createServerFn is called (tests/server-fn-policy.test.ts), and each function picks
// one of two doors on purpose.

// Runs before the handler, also for a direct call to the endpoint. Shop and user come from the request's session.
const requireManager = createMiddleware({ type: 'function' }).server(async ({ next }) => {
  // Imported here because session.functions itself uses publicFn from this file
  const { getAdminContext } = await import('./session.functions')
  const access = managerAccess(await getAdminContext())
  if (access.status === 'none') throw new Error('Sign in first')
  if (access.status === 'forbidden') throw new Error('Only shop owners and admins can do this')
  return next({ context: { shop: access.shop, shopId: access.shopId, userId: access.userId } })
})

/**
 * For the admin (GET: loaders and reads; adminPostFn: changes). The handler's `context` has the session's `shop`,
 * `shopId` and `userId`: use them and never take a shop, user or tenant URL from the input.
 * These are builders, not wrapper functions, so that TanStack's compiler still finds each createServerFn call.
 */
export const adminFn = createServerFn({ method: 'GET' }).middleware([requireManager])
export const adminPostFn = createServerFn({ method: 'POST' }).middleware([requireManager])

/**
 * Callable by anyone, with no session check. Only for buyer-facing pages (the cart token is the credential),
 * sign-in and setup, or a function that does its own check in the handler: say which in a comment.
 */
export const publicFn = createServerFn

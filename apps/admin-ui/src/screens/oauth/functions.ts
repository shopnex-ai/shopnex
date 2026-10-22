import { createServerFn } from '@tanstack/react-start'
import { AppError, appService, marketplaceService } from '@shopnex/apps'
import { getAdminContext } from '@/lib/session.functions'

// Without redirectUri: a managed install (installed right here, then opened inside the admin)
export type AuthorizeRequest = { clientId: string; redirectUri?: string; scope?: string; state?: string }

function withParams(redirectUri: string, params: Record<string, string | undefined>) {
  const url = new URL(redirectUri)
  for (const [key, value] of Object.entries(params)) if (value !== undefined) url.searchParams.set(key, value)
  return url.toString()
}

export const loadConsent = createServerFn({ method: 'GET' })
  .validator(
    (input: { clientId?: string; redirectUri?: string; scope?: string; state?: string; responseType?: string }) =>
      input,
  )
  .handler(async ({ data }) => {
    if (!data.clientId) return { error: 'The install link is missing client_id.' }
    if (data.responseType && data.responseType !== 'code') return { error: 'Only response_type=code is supported.' }
    const request: AuthorizeRequest = {
      clientId: data.clientId,
      redirectUri: data.redirectUri,
      scope: data.scope,
      state: data.state,
    }
    let validated
    try {
      validated = await appService.validateAuthorizeRequest(request)
    } catch (error) {
      if (!(error instanceof AppError)) throw error
      if (error.code === 'invalid_scope' && request.redirectUri)
        return { redirectTo: withParams(request.redirectUri, { error: 'invalid_scope', state: request.state }) }
      return { error: `${error.message}. Contact the app's developer.` }
    }
    const access = await getAdminContext()
    const { tenant, session } = access
    if (!tenant || !session) return { error: 'Your account is not a member of a shop.' }
    if (!tenant.superAdmin && tenant.role !== 'owner' && tenant.role !== 'admin')
      return { error: 'Only shop owners and admins can install apps.' }
    // An app with redirect URLs runs its own OAuth flow: it has to send one
    if (!request.redirectUri && !validated.app.managed)
      return { error: "The install link is missing redirect_uri. Contact the app's developer." }
    const installed = await appService.getInstallation(tenant.shop.id, validated.app.id)
    return {
      request,
      app: validated.app,
      scopes: validated.scopes,
      tenant: { id: tenant.shop.id, name: tenant.shop.name },
      installed,
      // Where the merchant ends up: the app's site, or (managed) the app inside this admin
      host: request.redirectUri ? new URL(request.redirectUri).host : null,
    }
  })

export const approveConsent = createServerFn({ method: 'POST' })
  .validator((request: AuthorizeRequest) => request)
  .handler(async ({ data }) => {
    const [access, validated] = await Promise.all([getAdminContext(), appService.validateAuthorizeRequest(data)])
    const { tenant, session } = access
    if (!tenant || !session || (!tenant.superAdmin && tenant.role !== 'owner' && tenant.role !== 'admin'))
      throw new Error('Only shop owners and admins can install apps')
    if (!data.redirectUri) {
      const installation = await appService.installManaged({
        appId: validated.app.id,
        shopId: tenant.shop.id,
        userId: session.user.id,
        scopes: validated.scopes,
      })
      void marketplaceService.reportInstallationsSoon()
      return `/admin/apps/${installation.id}`
    }
    const code = await appService.createAuthorizationCode({
      appId: validated.app.id,
      shopId: tenant.shop.id,
      userId: session.user.id,
      scopes: validated.scopes,
      redirectUri: data.redirectUri,
    })
    const instance = await marketplaceService.instanceUrl()
    return withParams(data.redirectUri, { code, state: data.state, shop_id: tenant.shop.id, instance })
  })

export const denyConsent = createServerFn({ method: 'POST' })
  .validator((request: AuthorizeRequest) => request)
  .handler(async ({ data }) => {
    await appService.validateAuthorizeRequest({ clientId: data.clientId, redirectUri: data.redirectUri })
    return data.redirectUri
      ? withParams(data.redirectUri, { error: 'access_denied', state: data.state })
      : '/admin/apps'
  })

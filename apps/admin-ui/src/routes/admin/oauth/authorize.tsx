import { createFileRoute, redirect } from '@tanstack/react-router'
import { loadConsent } from '@/screens/oauth/functions'
import { ConsentPage } from '@/screens/oauth/consent-page'

export const Route = createFileRoute('/admin/oauth/authorize')({
  validateSearch: (search: Record<string, unknown>) => ({
    client_id: typeof search.client_id === 'string' ? search.client_id : undefined,
    redirect_uri: typeof search.redirect_uri === 'string' ? search.redirect_uri : undefined,
    scope: typeof search.scope === 'string' ? search.scope : undefined,
    state: typeof search.state === 'string' ? search.state : undefined,
    response_type: typeof search.response_type === 'string' ? search.response_type : undefined,
  }),
  loader: async ({ location }) => {
    const query = new URLSearchParams(location.searchStr)
    const result = await loadConsent({
      data: {
        clientId: query.get('client_id') ?? undefined,
        redirectUri: query.get('redirect_uri') ?? undefined,
        scope: query.get('scope') ?? undefined,
        state: query.get('state') ?? undefined,
        responseType: query.get('response_type') ?? undefined,
      },
    })
    if ('redirectTo' in result && result.redirectTo) throw redirect({ href: result.redirectTo })
    if ('error' in result && result.error) return { error: result.error }
    if (!('app' in result) || !result.app) throw new Error('Unexpected consent result')
    return result as Extract<typeof result, { request: unknown }> & { error?: undefined }
  },
  component: ConsentPage,
})

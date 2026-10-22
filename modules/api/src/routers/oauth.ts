import { z } from 'zod'
import { ORPCError } from '@orpc/server'
import { CLIENT_ASSERTION_TYPE, appService, jwks, marketplaceService } from '@shopnex/apps'
import { pub } from '../orpc'

const TOKEN_EXCHANGE = 'urn:ietf:params:oauth:grant-type:token-exchange'

// OAuth 2.0 token endpoint for apps, called from the app's backend. JSON or form-encoded. The app
// authenticates with a client assertion (RFC 7523) signed by its key, addressed to this instance's origin;
// no client secret ever reaches us. Errors carry `data.error` (invalid_client, invalid_grant).
//   authorization_code   code + redirect_uri → long-lived token (sk_…)
//   token-exchange       subject_token = session token from the embedded admin page → 1-hour token (RFC 8693)
//   client_credentials   shop_id → 1-hour token for the app's installation there (background work)
export const oauth = {
  token: pub
    .route({ method: 'POST', path: '/oauth/token' })
    .input(
      z.object({
        grant_type: z.enum(['authorization_code', TOKEN_EXCHANGE, 'client_credentials']).default('authorization_code'),
        client_id: z.string().min(1).max(200),
        client_assertion_type: z.literal(CLIENT_ASSERTION_TYPE),
        client_assertion: z.string().min(1).max(4000),
        code: z.string().min(1).max(200).optional(),
        redirect_uri: z.string().min(1).max(2000).optional(),
        subject_token: z.string().min(1).max(4000).optional(),
        subject_token_type: z.string().optional(),
        shop_id: z.string().min(1).max(200).optional(),
      }),
    )
    .handler(async ({ input }) => {
      const client = { clientId: input.client_id, clientAssertion: input.client_assertion }
      const missing = (name: string) =>
        new ORPCError('BAD_REQUEST', { message: `${name} is required`, data: { error: 'invalid_request' } })

      if (input.grant_type === 'authorization_code') {
        if (!input.code || !input.redirect_uri) throw missing('code and redirect_uri')
        const result = await appService.exchangeCode({ ...client, code: input.code, redirectUri: input.redirect_uri })
        // Marketplace apps verify the install with the marketplace next: report it before answering
        await marketplaceService.reportInstallationsSoon()
        return {
          access_token: result.accessToken,
          token_type: 'bearer' as const,
          scope: result.scopes.join(','),
          shop_id: result.shopId,
          installation_id: result.installationId,
        }
      }

      const result =
        input.grant_type === TOKEN_EXCHANGE
          ? await appService.exchangeSessionToken({
              ...client,
              subjectToken: input.subject_token ?? throwError(missing('subject_token')),
            })
          : await appService.clientCredentials({ ...client, shopId: input.shop_id ?? throwError(missing('shop_id')) })
      return {
        access_token: result.accessToken,
        token_type: 'bearer' as const,
        expires_in: result.expiresIn,
        scope: result.scopes.join(','),
        shop_id: result.shopId,
        installation_id: result.installationId,
      }
    }),

  // This instance's public keys: apps check session tokens and payments requests against them
  jwks: pub.route({ method: 'GET', path: '/oauth/jwks' }).handler(() => jwks()),
}

function throwError(error: Error): never {
  throw error
}

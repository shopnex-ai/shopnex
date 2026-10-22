import { ORPCError } from '@orpc/server'
import { z } from 'zod'
import { createApiToken, listApiTokens, revokeApiToken } from '@shopnex/tenancy'
import { shopManager } from '../../orpc'
import { apiTokenInput } from './schemas'

// Settings → API tokens. Staff only: a token can't list, create or revoke tokens.
export const apiTokens = {
  list: shopManager
    .route({ method: 'GET', path: '/admin/api-tokens' })
    .handler(({ context }) => listApiTokens(context.shop.id)),

  // The response is the only time `token` is returned
  create: shopManager
    .route({ method: 'POST', path: '/admin/api-tokens' })
    .input(apiTokenInput)
    .handler(({ input, context }) => createApiToken(context.shop.id, { ...input, createdById: context.user.id })),

  revoke: shopManager
    .route({ method: 'POST', path: '/admin/api-tokens/{id}/revoke' })
    .input(z.object({ id: z.uuid() }))
    .handler(async ({ input, context }) => {
      const token = await revokeApiToken(context.shop.id, input.id)
      if (!token) throw new ORPCError('NOT_FOUND')
      return token
    }),
}

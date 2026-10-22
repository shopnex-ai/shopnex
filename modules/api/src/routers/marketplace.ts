import { ORPCError } from '@orpc/server'
import { z } from 'zod'
import { marketplaceService } from '@shopnex/apps'
import { pub } from '../orpc'

// Public: the app marketplace fetches this while we connect, to verify this instance's URL
export const marketplace = {
  challenge: pub
    .route({ method: 'GET', path: '/marketplace/challenge' })
    .output(z.object({ challenge: z.string() }))
    .handler(async () => {
      const challenge = await marketplaceService.pendingChallenge()
      if (!challenge) throw new ORPCError('NOT_FOUND', { message: 'No connection in progress' })
      return { challenge }
    }),
}

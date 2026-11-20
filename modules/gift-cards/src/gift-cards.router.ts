import { ORPCError } from '@orpc/server'
import { z } from 'zod'
import { db } from '@shopnex/db'
import { createProcedures } from '@shopnex/rpc'
import * as giftCardService from './gift-cards'
import { giftCardAdjustInput, giftCardDetailOutput, giftCardIssueInput, giftCardOutput } from './gift-cards.contract'

const { scoped } = createProcedures()

const id = z.object({ id: z.uuid() })
const found = <T>(row: T | null) => {
  if (!row) throw new ORPCError('NOT_FOUND')
  return row
}

const read = scoped('read_gift_cards')
const write = scoped('write_gift_cards')

// Gift cards: issued by staff here, or by a paid order for a gift card product
export const giftCards = {
  list: read
    .route({ method: 'GET', path: '/admin/gift-cards' })
    .output(z.array(giftCardOutput))
    .handler(({ context }) => giftCardService.list(context.shop.id, db)),
  get: read
    .route({ method: 'GET', path: '/admin/gift-cards/{id}' })
    .output(giftCardDetailOutput)
    .input(id)
    .handler(async ({ input, context }) => found(await giftCardService.getById(context.shop.id, input.id, db))),
  issue: write
    .route({ method: 'POST', path: '/admin/gift-cards' })
    .output(giftCardOutput)
    .input(giftCardIssueInput)
    .handler(({ input, context }) => giftCardService.issue(context.shop.id, input, db)),
  adjust: write
    .route({ method: 'POST', path: '/admin/gift-cards/{id}/adjust' })
    .output(giftCardOutput)
    .input(id.extend(giftCardAdjustInput.shape))
    .handler(({ input, context }) =>
      giftCardService.adjust(context.shop.id, input.id, input.amountCents, input.note ?? null, db),
    ),
  disable: write
    .route({ method: 'POST', path: '/admin/gift-cards/{id}/disable' })
    .output(giftCardOutput)
    .input(id)
    .handler(async ({ input, context }) =>
      found(await giftCardService.setActive(context.shop.id, input.id, false, db)),
    ),
  enable: write
    .route({ method: 'POST', path: '/admin/gift-cards/{id}/enable' })
    .output(giftCardOutput)
    .input(id)
    .handler(async ({ input, context }) => found(await giftCardService.setActive(context.shop.id, input.id, true, db))),
}

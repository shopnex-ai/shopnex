import { z } from 'zod'
import { platformService } from '@shopnex/tenancy'
import { superAdminOnly } from '../../orpc'
import { pagination } from '../pagination'

const list = pagination.extend({ search: z.string().trim().max(200).optional() })
const page = <T extends z.ZodType>(item: T) => z.object({ items: z.array(item), total: z.number().int() })

const overviewOutput = z.object({
  shops: z.number().int(),
  users: z.number().int(),
  newShops: z.number().int(),
  newUsers: z.number().int(),
  recentDays: z.number().int(),
})

const platformShopOutput = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  currency: z.string(),
  createdAt: z.date(),
  members: z.number().int(),
  orders: z.number().int(),
  ownerEmail: z.string().nullable(),
})

const platformUserOutput = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  role: z.string().nullable(),
  banned: z.boolean().nullable(),
  createdAt: z.date(),
  shops: z.number().int(),
})

// Every shop and user on this install (super admins). Read-only.
export const platform = {
  overview: superAdminOnly
    .route({ method: 'GET', path: '/admin/platform' })
    .output(overviewOutput)
    .handler(() => platformService.overview()),

  shops: superAdminOnly
    .route({ method: 'GET', path: '/admin/platform/shops' })
    .output(page(platformShopOutput))
    .input(list)
    .handler(({ input }) => platformService.listShops(input)),

  users: superAdminOnly
    .route({ method: 'GET', path: '/admin/platform/users' })
    .output(page(platformUserOutput))
    .input(list)
    .handler(({ input }) => platformService.listUsers(input)),
}

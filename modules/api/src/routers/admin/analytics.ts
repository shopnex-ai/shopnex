import { z } from 'zod'
import { orderAnalytics } from '@shopnex/orders'
import { scoped } from '../../orpc'

const timezone = z.string().refine(
  (tz) => {
    try {
      new Intl.DateTimeFormat('en', { timeZone: tz })
      return true
    } catch {
      return false
    }
  },
  { message: 'Unknown timezone' },
)

export const analytics = {
  // Home dashboard: sales, orders, average order value and returning customers vs the previous period
  overview: scoped('read_orders')
    .route({ method: 'GET', path: '/admin/analytics/overview' })
    .input(z.object({ days: z.coerce.number().int().min(1).max(365).default(30), timezone: timezone.default('UTC') }))
    .handler(({ input, context }) => orderAnalytics.overview(context.shop.id, input)),
}

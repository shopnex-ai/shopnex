import { serve } from '@hono/node-server'
import { createShopnexApp } from '@shopnex/app'
import { createOrderInquiryApp } from './app'

const app = createOrderInquiryApp(createShopnexApp())
const port = Number(process.env.PORT ?? 4501)
serve({ fetch: app.fetch, port, hostname: process.env.HOST ?? '127.0.0.1' }, () =>
  console.log(`Order inquiry app listening on port ${port}`),
)

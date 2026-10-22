// Production server for the built admin (`pnpm build`, then `pnpm start`): static files from dist/client,
// everything else goes to TanStack Start's fetch handler. Run from this folder. PORT and HOST are optional.
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'
import handler from './dist/server/server.js'

const app = new Hono()
// Built assets are content-hashed, so browsers can keep them forever
app.use('/assets/*', async (c, next) => {
  await next()
  if (c.res.ok) c.res.headers.set('cache-control', 'public, max-age=31536000, immutable')
})
app.use('*', serveStatic({ root: './dist/client' }))
app.all('*', (c) => handler.fetch(c.req.raw))

const port = Number(process.env.PORT ?? 3000)
serve({ fetch: app.fetch, port, hostname: process.env.HOST }, () => console.log(`Shopnex listening on :${port}`))

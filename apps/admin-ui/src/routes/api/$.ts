import { createFileRoute } from '@tanstack/react-router'
import { app } from '@shopnex/api'

const handler = ({ request }: { request: Request }) => app.fetch(request)

export const Route = createFileRoute('/api/$')({
  server: {
    handlers: {
      GET: handler,
      POST: handler,
      PUT: handler,
      PATCH: handler,
      DELETE: handler,
      OPTIONS: handler,
    },
  },
})

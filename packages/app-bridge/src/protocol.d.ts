// postMessage protocol between an embedded app (iframe) and the ShopNex admin (parent).
// The admin implements the other side in apps/admin-ui/src/screens/apps/[id]/embedded-app.tsx.

export type AppRequest =
  | { type: 'session-token' }
  | { type: 'toast'; message: string; isError?: boolean }
  | { type: 'redirect'; url: string }
  | { type: 'theme' }

export type AppMessage = { source: 'shopnex-app'; v: 1; id: string } & AppRequest

export type Theme = 'light' | 'dark'

// `theme` also arrives on its own (id '') whenever the admin's theme changes, not only as an answer to a request
export type AdminMessage = { source: 'shopnex-admin'; v: 1; id: string } & (
  | { type: 'session-token'; token: string }
  | { type: 'theme'; theme: Theme }
  | { type: 'error'; message: string }
  | { type: 'ok' }
)

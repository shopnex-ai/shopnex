// postMessage protocol between an embedded app (iframe) and the Shopnex admin (parent).
// The admin implements the other side in apps/admin-ui/src/screens/apps/[id]/embedded-app.tsx.

export type AppRequest =
  | { type: 'session-token' }
  | { type: 'toast'; message: string; isError?: boolean }
  | { type: 'redirect'; url: string }

export type AppMessage = { source: 'shopnex-app'; v: 1; id: string } & AppRequest

export type AdminMessage = { source: 'shopnex-admin'; v: 1; id: string } & (
  | { type: 'session-token'; token: string }
  | { type: 'error'; message: string }
  | { type: 'ok' }
)

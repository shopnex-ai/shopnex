# @shopnex/app-bridge

Lightweight browser client for embedded apps running inside the Shopnex admin. It communicates with the host admin window via `postMessage` to retrieve short-lived session tokens, make authenticated backend requests without third-party cookies, display toast notifications, and trigger top-level window redirects.

## Installation

```bash
pnpm add @shopnex/app-bridge
```

## Usage

Initialize the bridge inside an embedded iframe. The bridge automatically resolves the Shopnex instance from the `instance` query parameter added to your app URL by the admin:

```ts
import { createAppBridge } from '@shopnex/app-bridge'

const bridge = createAppBridge()

// Call your app backend with an automatic Authorization: Bearer <session-token> header
const res = await bridge.authenticatedFetch('/api/settings', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ notifications: true }),
})

// Display a toast in the Shopnex admin
await bridge.toast('Settings saved')

// Or display an error toast
await bridge.toast('Failed to update settings', { isError: true })

// Retrieve a fresh session token (JWT, valid for 60s) directly
const token = await bridge.getSessionToken()

// Redirect the parent admin window (e.g. to restart OAuth when framed)
await bridge.redirect('https://example.com/oauth/authorize')
```

## Entry points

- `@shopnex/app-bridge`: `createAppBridge`, `AppBridge`, `AdminMessage`, `AppMessage`, and `AppRequest`.

## Documentation

See [Shopnex Apps](https://github.com/shopnex-ai/shopnex/blob/main/docs/apps.md) for architecture details, and the [App SDK Guide](https://github.com/shopnex-ai/shopnex/blob/main/apps/docs/content/docs/apps/sdk.mdx) for frontend components and backend token verification.

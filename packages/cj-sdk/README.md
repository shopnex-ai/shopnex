# @shopnex/cj-sdk

Typed client for the [CJ Dropshipping](https://developers.cjdropshipping.com) API, ported from the `@shopnex/cj-plugin` SDK on `legacy/v1`.

```ts
import { cjSdk } from '@shopnex/cj-sdk'

const cj = cjSdk({ accessToken })
```

Covers products, variants, inventory, orders, disputes and settings. The access-token helpers live in `src/sdk/auth.ts` and `src/sdk/access-token.ts`.

## Authentication

CJ now issues tokens from an API key (`POST authentication/getAccessToken` with `{ apiKey }`); email/password is no longer accepted. The token helpers read `CJ_API_KEY` (and optionally `CJ_REFRESH_TOKEN`) from the environment.

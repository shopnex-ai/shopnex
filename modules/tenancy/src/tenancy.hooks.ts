// Points where other modules act on what happens to an API token, without tenancy knowing them (see defineHook in @shopnex/kit).
import type { Conn } from '@shopnex/db'
import { defineHook } from '@shopnex/kit'

/** An API token was revoked. Runs inside the revoking transaction: a listener that throws undoes the revoke. */
export const apiTokenRevoked = defineHook<{ shopId: string; tokenId: string }, Conn>('api-token.revoked')

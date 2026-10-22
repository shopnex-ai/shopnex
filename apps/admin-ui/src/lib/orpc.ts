'use client'

import { createORPCClient } from '@orpc/client'
import { RPCLink } from '@orpc/client/fetch'
import type { InferRouterInputs, InferRouterOutputs, RouterClient } from '@orpc/server'
import { createTanstackQueryUtils } from '@orpc/tanstack-query'
import type { Router } from '@shopnex/api/router'

const link = new RPCLink({
  url: () => `${window.location.origin}/api/rpc`,
})

export const client: RouterClient<Router> = createORPCClient(link)
export const orpc = createTanstackQueryUtils(client)

/** Procedure outputs, e.g. `Outputs['admin']['customers']['get']` */
export type Outputs = InferRouterOutputs<Router>
/** Procedure inputs, e.g. `Inputs['admin']['orders']['list']` */
export type Inputs = InferRouterInputs<Router>

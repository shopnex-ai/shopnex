import { z } from 'zod'
import type { schema } from '@shopnex/db'
import { challengeHost, domainService, isMultiTenant } from '@shopnex/tenancy'
import { shopManager } from '../../orpc'
import { domainInput } from './schemas'

const id = z.object({ id: z.uuid() })

// What the admin shows: the row plus the DNS record the shop has to add
const view = (d: schema.ShopDomain) => ({
  id: d.id,
  domain: d.domain,
  verified: d.verifiedAt !== null,
  verifiedAt: d.verifiedAt,
  createdAt: d.createdAt,
  record: { type: 'TXT' as const, name: challengeHost(d.domain), value: d.verificationToken },
})

// Storefront domains. Verifying one proves the shop controls the host. Only used to pick the shop for a request
// when TENANCY_MODE=multi (`routing` tells the admin whether that's on).
export const domains = {
  list: shopManager.route({ method: 'GET', path: '/admin/domains' }).handler(async ({ context }) => ({
    routing: isMultiTenant,
    domains: (await domainService.listDomains(context.shop.id)).map((d) => view(d)),
  })),

  create: shopManager
    .route({ method: 'POST', path: '/admin/domains' })
    .input(domainInput)
    .handler(async ({ input, context }) => view(await domainService.addDomain(context.shop.id, input.domain))),

  verify: shopManager
    .route({ method: 'POST', path: '/admin/domains/{id}/verify' })
    .input(id)
    .handler(async ({ input, context }) => {
      const { domain, verified } = await domainService.verifyDomain(context.shop.id, input.id)
      return { verified, domain: view(domain) }
    }),

  delete: shopManager
    .route({ method: 'DELETE', path: '/admin/domains/{id}' })
    .input(id)
    .handler(async ({ input, context }) => {
      await domainService.removeDomain(context.shop.id, input.id)
      return { ok: true }
    }),
}

import { ORPCError } from '@orpc/server'
import { z } from 'zod'
import { createProcedures, pagination } from '@shopnex/rpc'
import { createApiToken, listApiTokens, revokeApiToken } from './api-tokens'
import { isMultiTenant } from './config'
import * as domainService from './domains'
import * as platformService from './platform'
import * as staffService from './staff'
import { updateShop } from './shops'
import {
  apiTokenCreatedOutput,
  apiTokenInput,
  apiTokenOutput,
  deletedOutput,
  domainCreatedOutput,
  domainInput,
  domainVerifiedOutput,
  domainsListOutput,
  invitationOutput,
  memberOutput,
  shopInput,
  shopOutput,
  staffInviteInput,
  staffListOutput,
  staffRole,
} from './tenancy.contract'
import { INVITATION_EXPIRES_IN_DAYS, type ShopDomain } from './tenancy.schema'

const { adminOrToken, shopManager, superAdminOnly } = createProcedures()

// The shop the admin (or API token) is working in
export const shop = {
  get: adminOrToken
    .route({ method: 'GET', path: '/admin/shop' })
    .output(shopOutput)
    .handler(({ context }) => ({ ...context.shop, storefrontUrlManaged: isMultiTenant })),

  update: shopManager
    .route({ method: 'PATCH', path: '/admin/shop' })
    .output(shopOutput)
    .input(shopInput.partial())
    .handler(async ({ input, context }) => {
      const updated = await updateShop(context.shop.id, input)
      if (!updated) throw new ORPCError('NOT_FOUND')
      return { ...updated, storefrontUrlManaged: isMultiTenant }
    }),
}

const actorOf = (context: { user: { id: string }; role: 'owner' | 'admin' | 'member'; superAdmin: boolean }) => ({
  userId: context.user.id,
  role: context.role,
  superAdmin: context.superAdmin,
})

// Members and invitations of the shop. Owners/admins of the shop, or a super admin (any shop).
export const staff = {
  list: shopManager
    .route({ method: 'GET', path: '/admin/staff' })
    .output(staffListOutput)
    .handler(async ({ context }) => {
      const [members, invitations] = await Promise.all([
        staffService.listMembers(context.shop.id),
        staffService.listInvitations(context.shop.id),
      ])
      return { members, invitations }
    }),

  invite: shopManager
    .route({ method: 'POST', path: '/admin/staff/invitations' })
    .output(invitationOutput)
    .input(staffInviteInput)
    .handler(({ input, context }) =>
      staffService.invite(context.shop.id, actorOf(context), input, INVITATION_EXPIRES_IN_DAYS),
    ),

  cancelInvitation: shopManager
    .route({ method: 'POST', path: '/admin/staff/invitations/{id}/cancel' })
    .output(invitationOutput)
    .input(z.object({ id: z.string() }))
    .handler(async ({ input, context }) => {
      const invitation = await staffService.cancelInvitation(context.shop.id, input.id)
      if (!invitation) throw new ORPCError('NOT_FOUND')
      return invitation
    }),

  updateRole: shopManager
    .route({ method: 'PATCH', path: '/admin/staff/members/{id}' })
    .output(memberOutput)
    .input(z.object({ id: z.string(), role: staffRole }))
    .handler(({ input, context }) => staffService.updateRole(context.shop.id, actorOf(context), input.id, input.role)),

  remove: shopManager
    .route({ method: 'DELETE', path: '/admin/staff/members/{id}' })
    .output(memberOutput)
    .input(z.object({ id: z.string() }))
    .handler(({ input, context }) => staffService.removeMember(context.shop.id, actorOf(context), input.id)),
}

const id = z.object({ id: z.uuid() })

// What the admin shows: the row plus the DNS record the shop has to add
const view = (d: ShopDomain) => ({
  id: d.id,
  domain: d.domain,
  verified: d.verifiedAt !== null,
  verifiedAt: d.verifiedAt,
  createdAt: d.createdAt,
  record: { type: 'TXT' as const, name: domainService.challengeHost(d.domain), value: d.verificationToken },
})

// Storefront domains. Verifying one proves the shop controls the host. Only used to pick the shop for a request
// when TENANCY_MODE=multi (`routing` tells the admin whether that's on).
export const domains = {
  list: shopManager
    .route({ method: 'GET', path: '/admin/domains' })
    .output(domainsListOutput)
    .handler(async ({ context }) => ({
      routing: isMultiTenant,
      domains: (await domainService.listDomains(context.shop.id)).map((d) => view(d)),
    })),

  create: shopManager
    .route({ method: 'POST', path: '/admin/domains' })
    .output(domainCreatedOutput)
    .input(domainInput)
    .handler(async ({ input, context }) => view(await domainService.addDomain(context.shop.id, input.domain))),

  verify: shopManager
    .route({ method: 'POST', path: '/admin/domains/{id}/verify' })
    .output(domainVerifiedOutput)
    .input(id)
    .handler(async ({ input, context }) => {
      const { domain, verified } = await domainService.verifyDomain(context.shop.id, input.id)
      return { verified, domain: view(domain) }
    }),

  delete: shopManager
    .route({ method: 'DELETE', path: '/admin/domains/{id}' })
    .output(deletedOutput)
    .input(id)
    .handler(async ({ input, context }) => {
      await domainService.removeDomain(context.shop.id, input.id)
      return { ok: true }
    }),
}

// Settings → API tokens. Staff only: a token can't list, create or revoke tokens.
export const apiTokens = {
  list: shopManager
    .route({ method: 'GET', path: '/admin/api-tokens' })
    .output(z.array(apiTokenOutput))
    .handler(({ context }) => listApiTokens(context.shop.id)),

  // The response is the only time `token` is returned
  create: shopManager
    .route({ method: 'POST', path: '/admin/api-tokens' })
    .output(apiTokenCreatedOutput)
    .input(apiTokenInput)
    .handler(({ input, context }) => createApiToken(context.shop.id, { ...input, createdById: context.user.id })),

  revoke: shopManager
    .route({ method: 'POST', path: '/admin/api-tokens/{id}/revoke' })
    .output(apiTokenOutput)
    .input(z.object({ id: z.uuid() }))
    .handler(async ({ input, context }) => {
      const token = await revokeApiToken(context.shop.id, input.id)
      if (!token) throw new ORPCError('NOT_FOUND')
      return token
    }),
}

const list = pagination.extend({ search: z.string().trim().max(200).optional() })
const page = <T extends z.ZodType>(item: T) => z.object({ items: z.array(item), total: z.number().int() })

const overviewOutput = z.object({
  shops: z.number().int(),
  users: z.number().int(),
  newShops: z.number().int(),
  newUsers: z.number().int(),
  recentDays: z.number().int(),
})

const platformShopOutput = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  currency: z.string(),
  createdAt: z.date(),
  members: z.number().int(),
  orders: z.number().int(),
  ownerEmail: z.string().nullable(),
})

const platformUserOutput = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  role: z.string().nullable(),
  banned: z.boolean().nullable(),
  createdAt: z.date(),
  shops: z.number().int(),
})

// Every shop and user on this install (super admins). Read-only.
export const platform = {
  overview: superAdminOnly
    .route({ method: 'GET', path: '/admin/platform' })
    .output(overviewOutput)
    .handler(() => platformService.overview()),

  shops: superAdminOnly
    .route({ method: 'GET', path: '/admin/platform/shops' })
    .output(page(platformShopOutput))
    .input(list)
    .handler(({ input }) => platformService.listShops(input)),

  users: superAdminOnly
    .route({ method: 'GET', path: '/admin/platform/users' })
    .output(page(platformUserOutput))
    .input(list)
    .handler(({ input }) => platformService.listUsers(input)),
}

// The tables of this module. `pnpm db:generate` finds them through modules/*/src/*.schema.ts; the migrations stay one
// history in modules/db/migrations. `shops` and `api_tokens` stay in @shopnex/db/schema with the other foundation tables
// (shops, user, apps, api_tokens): every module points at them. Shops are Better Auth "organizations" (organization plugin,
// renamed via modelName); TS keys must match Better Auth field names, DB columns use shop_* naming.
import { sql } from 'drizzle-orm'
import { pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core'
import { shops, user } from '@shopnex/db/schema'

export const shopMembers = pgTable(
  'shop_members',
  {
    id: text('id').primaryKey(),
    organizationId: text('shop_id')
      .notNull()
      .references(() => shops.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    role: text('role').notNull().default('member'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('shop_members_shop_user_idx').on(t.organizationId, t.userId)],
)

export const shopInvitations = pgTable('shop_invitations', {
  id: text('id').primaryKey(),
  organizationId: text('shop_id')
    .notNull()
    .references(() => shops.id, { onDelete: 'cascade' }),
  email: text('email').notNull(),
  role: text('role'),
  teamId: text('team_id'),
  status: text('status').notNull().default('pending'),
  expiresAt: timestamp('expires_at').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  inviterId: text('inviter_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
})

// Storefront host → shop (multi mode). e.g. acme.shopnex.com, shop.acme.com
// Only verified domains resolve: the shop proves it controls the host with a DNS TXT record holding the token.
export const shopDomains = pgTable('shop_domains', {
  id: text('id').primaryKey(),
  shopId: text('shop_id')
    .notNull()
    .references(() => shops.id, { onDelete: 'cascade' }),
  domain: text('domain').notNull().unique(),
  verificationToken: text('verification_token')
    .notNull()
    .default(sql`gen_random_uuid()::text`),
  verifiedAt: timestamp('verified_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

export type ShopDomain = typeof shopDomains.$inferSelect

// Roles staff can be given (invitation or role change). 'owner' exists but isn't handed out.
export const STAFF_ROLES = ['admin', 'member'] as const
export type StaffRole = (typeof STAFF_ROLES)[number]

// Every role a member can have in a shop. 'owner' is the first account to join it and can't be changed from Staff.
export const SHOP_ROLES = ['owner', 'admin', 'member'] as const
export type ShopRole = (typeof SHOP_ROLES)[number]
// The docs' roles table is generated from this; a new role without a description fails typecheck.
export const SHOP_ROLE_DESCRIPTIONS: Record<ShopRole, string> = {
  owner: 'The first account to join the shop. Full access, including creating and changing admins.',
  admin:
    'Manages API tokens, webhooks, storefront keys and shop settings, and staff with the member role. Only an owner can create or change admins.',
  member: 'Works with products, orders and customers. Cannot manage API tokens, webhooks or storefront keys.',
}
export type ShopMember = typeof shopMembers.$inferSelect

// Days a staff invitation can be accepted (the organization plugin of Better Auth and the Staff page both use it)
export const INVITATION_EXPIRES_IN_DAYS = 7

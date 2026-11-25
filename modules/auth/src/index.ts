import { betterAuth, type BetterAuthOptions } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { admin, organization } from 'better-auth/plugins'
import { createAccessControl } from 'better-auth/plugins/access'
import { adminAc, defaultStatements, userAc } from 'better-auth/plugins/admin/access'
import { db } from '@shopnex/db'
import { sessionSecret } from '@shopnex/db/secrets'
import { isMultiTenant, isOpenSignup } from '@shopnex/tenancy'
import type { SocialProvider } from './providers'
import { account, session, verification } from './auth.schema'
import { APIError, createAuthMiddleware } from 'better-auth/api'
import { assertSignUpAllowed, createShopForNewAccount } from './sign-up-policy'
import { SIGNUP_LIMIT_MESSAGE, checkSignupRate, clientIpHeaders } from './signup-limit'
import { INVITATION_EXPIRES_IN_DAYS, SUPER_ADMIN_ROLE } from './roles'
import { shopInvitations, shopMembers } from '@shopnex/tenancy/schema'
import { shops as shopsTable, user as userTable } from '@shopnex/core/schema'

// A provider is enabled only when both its credentials are set.
// OAuth callback URL to register: {APP_URL}/api/auth/callback/{provider}
// Platform access control: superadmin gets every admin-plugin permission, regular users none
const ac = createAccessControl(defaultStatements)

const socialProviders = {
  ...(process.env.GOOGLE_CLIENT_ID &&
    process.env.GOOGLE_CLIENT_SECRET && {
      google: {
        clientId: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      },
    }),
  ...(process.env.GITHUB_CLIENT_ID &&
    process.env.GITHUB_CLIENT_SECRET && {
      github: {
        clientId: process.env.GITHUB_CLIENT_ID,
        clientSecret: process.env.GITHUB_CLIENT_SECRET,
      },
    }),
} satisfies BetterAuthOptions['socialProviders']

export const enabledSocialProviders = Object.keys(socialProviders) as SocialProvider[]

// The public origin. Left out when APP_URL is unset or empty (a docker compose variable that is not set is an empty
// string): Better Auth then reads the old BETTER_AUTH_URL itself, or works it out from the request
const baseURL = process.env.APP_URL

export const auth = betterAuth({
  basePath: '/api/auth',
  secret: sessionSecret(),
  ...(baseURL && { baseURL }),
  database: drizzleAdapter(db, {
    provider: 'pg',
    schema: {
      user: userTable,
      session,
      account,
      verification,
      shops: shopsTable,
      shopMembers: shopMembers,
      shopInvitations: shopInvitations,
    },
  }),
  emailAndPassword: { enabled: true },
  // Better Auth limits sign-in and sign-up requests per address (on in production). CLIENT_IP_HEADER says which header
  // carries the address (cf-connecting-ip behind Cloudflare); open sign-up's hourly caps are in the hook below.
  ...(process.env.CLIENT_IP_HEADER && { advanced: { ipAddress: { ipAddressHeaders: clientIpHeaders() } } }),
  hooks: {
    // Better Auth's hook type returns a promise, and a throw here has to reject it, so this stays async without an await
    // eslint-disable-next-line @typescript-eslint/require-await
    before: createAuthMiddleware(async (ctx) => {
      // Open sign-up: the per address cap (signup-limit.ts). Server calls have no request and are not counted.
      if (isOpenSignup && ctx.path === '/sign-up/email' && ctx.request && !checkSignupRate(ctx.request.headers).ok)
        throw new APIError('TOO_MANY_REQUESTS', { message: SIGNUP_LIMIT_MESSAGE })
    }),
  },
  socialProviders,
  databaseHooks: {
    user: {
      // Invitation only (see sign-up-policy). Invitees join their shop by accepting the invitation.
      create: {
        before: async (user) => {
          await assertSignUpAllowed(user.email)
        },
        after: async (user) => createShopForNewAccount(user),
      },
    },
  },
  plugins: [
    // Staff only: customers are not users here (@shopnex/customers has their own codes and sessions), and there is no
    // bearer or emailOTP plugin, so no token or code a customer holds can become a staff session
    // Platform role on the user: 'superadmin' can access every shop (plus ban/impersonate users)
    admin({
      ac,
      roles: {
        [SUPER_ADMIN_ROLE]: ac.newRole(adminAc.statements),
        user: ac.newRole(userAc.statements),
      },
      adminRoles: [SUPER_ADMIN_ROLE],
      defaultRole: 'user',
    }),
    // Shops = organizations: membership, roles, invitations, active shop on the session
    organization({
      allowUserToCreateOrganization: isMultiTenant,
      // Invite links (copied from Admin → Staff until email sending exists)
      invitationExpiresIn: INVITATION_EXPIRES_IN_DAYS * 24 * 60 * 60,
      schema: {
        organization: { modelName: 'shops' },
        member: { modelName: 'shopMembers' },
        invitation: { modelName: 'shopInvitations' },
      },
    }),
  ],
})

export type Auth = typeof auth
export type Session = typeof auth.$Infer.Session
export type { SocialProvider } from './providers'
export { INVITATION_EXPIRES_IN_DAYS, SUPER_ADMIN_ROLE, isSuperAdmin } from './roles'
export { withSignUpAllowed } from './sign-up-policy'
export { setActiveShop } from './active-shop'
export { rateLeft, takeRate } from './rate-limit'
export { clientIp } from './signup-limit'

import { betterAuth, type BetterAuthOptions } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { admin, organization } from 'better-auth/plugins'
import { createAccessControl } from 'better-auth/plugins/access'
import { adminAc, defaultStatements, userAc } from 'better-auth/plugins/admin/access'
import { db, schema } from '@shopnex/db'
import { isMultiTenant } from '@shopnex/tenancy'
import type { SocialProvider } from './providers'
import { assertSignUpAllowed } from './sign-up-policy'
import { INVITATION_EXPIRES_IN_DAYS, SUPER_ADMIN_ROLE } from './roles'

// A provider is enabled only when both its credentials are set.
// OAuth callback URL to register: {BETTER_AUTH_URL}/api/auth/callback/{provider}
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

export const auth = betterAuth({
  basePath: '/api/auth',
  database: drizzleAdapter(db, {
    provider: 'pg',
    schema: {
      user: schema.user,
      session: schema.session,
      account: schema.account,
      verification: schema.verification,
      shops: schema.shops,
      shopMembers: schema.shopMembers,
      shopInvitations: schema.shopInvitations,
    },
  }),
  emailAndPassword: { enabled: true },
  socialProviders,
  databaseHooks: {
    user: {
      // Invitation only (see sign-up-policy). Invitees join their shop by accepting the invitation.
      create: { before: async (user) => void (await assertSignUpAllowed(user.email)) },
    },
  },
  plugins: [
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
export { SUPER_ADMIN_ROLE, isSuperAdmin } from './roles'
export { withSignUpAllowed } from './sign-up-policy'

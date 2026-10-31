import { betterAuth, type BetterAuthOptions } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { admin, bearer, emailOTP, organization } from 'better-auth/plugins'
import { createAccessControl } from 'better-auth/plugins/access'
import { adminAc, defaultStatements, userAc } from 'better-auth/plugins/admin/access'
import { db, schema } from '@shopnex/db'
import { isMultiTenant } from '@shopnex/tenancy'
import type { SocialProvider } from './providers'
import { APIError, createAuthMiddleware } from 'better-auth/api'
import { assertSignUpAllowed } from './sign-up-policy'
import { LOGIN_CODE_ATTEMPTS, LOGIN_CODE_LENGTH, LOGIN_CODE_TTL_S, currentOtpSender, isOtpPath } from './shopper-login'
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
  hooks: {
    // The emailOTP plugin is only for customer sign-in through our own server code (see shopper-login)
    before: createAuthMiddleware(async (ctx) => {
      if (isOtpPath(ctx.path) && !currentOtpSender()) throw new APIError('FORBIDDEN', { message: 'Not available' })
    }),
  },
  socialProviders,
  databaseHooks: {
    user: {
      // Invitation only (see sign-up-policy). Invitees join their shop by accepting the invitation.
      create: { before: async (user) => void (await assertSignUpAllowed(user.email)) },
    },
  },
  plugins: [
    // Customer sessions travel as `Authorization: Bearer <token>` (the storefront keeps the token in its own
    // cookie); staff keep using cookies
    bearer(),
    // Customer sign-in: a code by email. Codes are stored hashed. Only server code that supplies a sender
    // (shopper-login.ts) can trigger one, so the plugin's public endpoints can't send mail or sign anyone up.
    emailOTP({
      otpLength: LOGIN_CODE_LENGTH,
      expiresIn: LOGIN_CODE_TTL_S,
      allowedAttempts: LOGIN_CODE_ATTEMPTS,
      storeOTP: 'hashed',
      async sendVerificationOTP({ email, otp, type }) {
        const send = currentOtpSender()
        if (type !== 'sign-in' || !send) throw new APIError('FORBIDDEN', { message: 'Not available' })
        await send(email, otp)
      },
    }),
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
export { withOtpSender, withOtpSignIn, LOGIN_CODE_TTL_S } from './shopper-login'

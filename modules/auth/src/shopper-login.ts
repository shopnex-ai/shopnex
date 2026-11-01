// Storefront customers sign in with an emailed one-time code (Better Auth's emailOTP plugin). They share the
// `user` table with staff but have no shop membership, so they reach nothing in the admin. The plugin's
// HTTP endpoints stay inert: the code is only sent when our own server code opts in with `withOtpSender`
// (the sender is per shop, which Better Auth knows nothing about).
import { AsyncLocalStorage } from 'node:async_hooks'

export const LOGIN_CODE_LENGTH = 6
/** Seconds a code works; the email says so (LOGIN_CODE_MINUTES in @shopnex/email) */
export const LOGIN_CODE_TTL_S = 10 * 60
export const LOGIN_CODE_ATTEMPTS = 5

type OtpSender = (email: string, code: string) => Promise<void>

const senders = new AsyncLocalStorage<OtpSender>()

/** Runs `fn` with `send` delivering the sign-in codes Better Auth generates inside it */
export const withOtpSender = <T>(send: OtpSender, fn: () => Promise<T>) => senders.run(send, fn)

/** Runs `fn` (checking a code and signing in) as customer sign-in; sending a code is not part of it */
export const withOtpSignIn = <T>(fn: () => Promise<T>) =>
  senders.run(async () => {
    throw new Error('A code is not sent while signing in')
  }, fn)

export const currentOtpSender = () => senders.getStore()

/**
 * Better Auth's emailOTP endpoints (/email-otp/*, /sign-in/email-otp) are reachable over HTTP too. A customer
 * who used one would get a regular Better Auth session cookie (which in multi mode can even create a shop), so
 * they only work for calls our own server code makes inside withOtpSender / withOtpSignIn.
 */
export const isOtpPath = (path: string) => path.startsWith('/email-otp/') || path === '/sign-in/email-otp'

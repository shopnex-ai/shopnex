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

export const currentOtpSender = () => senders.getStore()

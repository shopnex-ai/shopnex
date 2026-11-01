// Self-serve signup (OPEN_SIGNUP=true, multi mode): an account plus its own shop in one step.
import { createShop, isOpenSignup } from '@shopnex/tenancy'
import { auth } from './index'

export class SignupError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SignupError'
  }
}

export type SignupInput = { email: string; password: string; shopName: string }

export async function signUpWithShop(input: SignupInput) {
  if (!isOpenSignup) throw new SignupError('Sign-up is by invitation only')
  const name = input.email.split('@')[0]!.slice(0, 100)
  const { user } = await auth.api.signUpEmail({ body: { name, email: input.email, password: input.password } })
  const shop = await createShop({ ownerId: user.id, name: input.shopName })
  return { user, shop }
}

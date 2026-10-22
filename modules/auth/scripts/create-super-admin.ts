// Create a platform super admin, or promote an existing user.
//   pnpm create-super-admin --email you@example.com [--password ...] [--name ...]
// Without --password a random one is generated and printed once.
import { randomBytes } from 'node:crypto'
import { parseArgs } from 'node:util'
import { eq } from 'drizzle-orm'
import { db, schema } from '@shopnex/db'
import { auth, SUPER_ADMIN_ROLE, withSignUpAllowed } from '../src'

const { values } = parseArgs({
  options: {
    email: { type: 'string' },
    password: { type: 'string' },
    name: { type: 'string', default: 'Super Admin' },
  },
})

const email = values.email?.toLowerCase()
if (!email) {
  console.error('Usage: pnpm create-super-admin --email you@example.com [--password ...] [--name ...]')
  process.exit(1)
}

const [existing] = await db.select().from(schema.user).where(eq(schema.user.email, email))

let generatedPassword: string | undefined
if (existing) {
  if (values.password) console.warn('User exists — --password ignored (password unchanged).')
} else {
  const password = values.password ?? (generatedPassword = randomBytes(12).toString('base64url'))
  // Super admins act in every shop without membership
  await withSignUpAllowed(() => auth.api.signUpEmail({ body: { email, password, name: values.name! } }))
}

await db.update(schema.user).set({ role: SUPER_ADMIN_ROLE }).where(eq(schema.user.email, email))

console.log(`${existing ? 'Promoted' : 'Created'} super admin: ${email}`)
if (generatedPassword) console.log(`Password (shown once): ${generatedPassword}`)
console.log('Sign in at /admin/login')
process.exit(0)

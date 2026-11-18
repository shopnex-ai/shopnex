// The shape of the first-run setup form and of a sign-up: just an email and a password. Plain Zod, no server code (the admin imports it for form
// validation).
import { z } from 'zod'

export const MIN_PASSWORD = 8

// First-run setup (/admin/setup): just the owner account. The shop keeps its defaults (DEFAULT_SHOP_NAME, USD) until
// it is renamed in Settings.
export const setupInput = z.object({
  email: z.email(),
  password: z.string().min(MIN_PASSWORD).max(128),
})

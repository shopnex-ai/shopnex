// What the buyer gives at checkout. The form validates with it in the browser and `placeOrder` again on the
// server, so both reject exactly the same input.
import { z } from 'zod'

const optional = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((value) => value || undefined)
export const buyer = z.object({
  email: z.email('Enter a valid email'),
  firstName: optional(100),
  lastName: z.string().trim().min(1, 'Enter a last name').max(100),
  company: optional(200),
  address1: z.string().trim().min(1, 'Enter an address').max(200),
  address2: optional(200),
  city: z.string().trim().min(1, 'Enter a city').max(100),
  province: optional(100),
  countryCode: z.string().regex(/^[A-Z]{2}$/, 'Choose a country'),
  zip: optional(20),
  phone: optional(40),
  // A flat rate's id, or carrier:{service}:{code} for a carrier service's live rate
  shippingRateId: z.string().max(200).optional(),
  paymentMethodId: z.uuid('Choose a payment method'),
  note: optional(1000),
})
export const checkoutFieldNames = Object.keys(buyer.shape)

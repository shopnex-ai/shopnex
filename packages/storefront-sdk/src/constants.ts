// Dependency-free (no zod/oRPC), so browser code doing a plain fetch can import it cheaply.

export const PUBLISHABLE_KEY_HEADER = 'x-shopnex-key'

/** Carries the token from `customer.signIn` on requests for a signed-in customer */
export const CUSTOMER_TOKEN_HEADER = 'x-shopnex-customer-token'

/** Path of the public REST API on a Shopnex origin */
export const API_BASE_PATH = '/api/v1'

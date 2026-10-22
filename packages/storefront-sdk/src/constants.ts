// Dependency-free (no zod/oRPC), so browser code doing a plain fetch can import it cheaply.

export const PUBLISHABLE_KEY_HEADER = 'x-shopnex-key'

/** Path of the public REST API on a Shopnex origin */
export const API_BASE_PATH = '/api/v1'

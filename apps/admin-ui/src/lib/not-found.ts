import { notFound } from '@tanstack/react-router'

/**
 * Whether an API error means "there is no such record": NOT_FOUND, or BAD_REQUEST for an id that is not even a valid
 * uuid (what a mistyped or truncated URL gives). Duck-typed so it also works for errors that crossed the server-function
 * boundary or come from the server-side client.
 */
export function isMissing(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('code' in error)) return false
  return error.code === 'NOT_FOUND' || error.code === 'BAD_REQUEST'
}

/**
 * For a loader that fetches a record by the id in the URL: a record that is gone shows the route's not-found page, not
 * the error page. Anything else is still an error.
 */
export async function orNotFound<T>(request: Promise<T>): Promise<T> {
  try {
    return await request
  } catch (error) {
    if (isMissing(error)) throw notFound()
    throw error
  }
}

// What an API token's scopes allow. Pure functions over the scope list, safe for the browser, in core so that a module that only needs
// to check or tidy scopes (webhooks, ai, apps, the api) does not have to depend on tenancy, which would put it in a cycle.
import { API_SCOPES, type ApiScope } from './core.schema'

// write_* includes read_*
export function hasScope(scopes: readonly ApiScope[], needed: ApiScope) {
  return (
    scopes.includes(needed) ||
    (needed.startsWith('read_') && scopes.includes(needed.replace('read_', 'write_') as ApiScope))
  )
}

// A write scope already grants read: keep the list minimal (and in API_SCOPES order, without duplicates)
export function normalizeScopes(scopes: readonly ApiScope[]): ApiScope[] {
  return API_SCOPES.filter(
    (s) => scopes.includes(s) && !(s.startsWith('read_') && scopes.includes(s.replace('read_', 'write_') as ApiScope)),
  )
}

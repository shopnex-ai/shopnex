export type { AdminMessage, AppMessage, AppRequest } from './protocol'

export type AppBridge = {
  /** The Shopnex instance origin the app is embedded in */
  readonly instance: string
  /** A fresh session token (JWT, valid 60s) for your backend: verify it with verifySessionToken */
  getSessionToken(): Promise<string>
  /** fetch() with `Authorization: Bearer <session token>` */
  authenticatedFetch(input: string | URL | Request, init?: RequestInit): Promise<Response>
  /** Shows a toast in the admin */
  toast(message: string, options?: { isError?: boolean }): Promise<void>
  /** Navigates the whole admin window (e.g. to restart OAuth: the consent screen can't be framed) */
  redirect(url: string): Promise<void>
}

/**
 * Connects to the Shopnex admin this page is embedded in. `instance` defaults to the `instance` query
 * parameter the admin adds to your app URL.
 */
export function createAppBridge(options?: { instance?: string; timeoutMs?: number }): AppBridge

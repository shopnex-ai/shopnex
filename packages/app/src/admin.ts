// The Shopnex Admin API for one shop, with an access token the SDK fetches (and refreshes) itself, plus the
// app's own per-shop storage on top of it.

export class ShopnexError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: string,
  ) {
    super(message)
    this.name = 'ShopnexError'
  }
}

export type AdminClient = {
  /** Raw fetch against {instance}/api/v1/admin{path}, with the token */
  fetch(path: string, init?: RequestInit): Promise<Response>
  get<T = unknown>(path: string): Promise<T>
  post<T = unknown>(path: string, body?: unknown): Promise<T>
  put<T = unknown>(path: string, body?: unknown): Promise<T>
  patch<T = unknown>(path: string, body?: unknown): Promise<T>
  delete<T = unknown>(path: string): Promise<T>
}

/** `reachAt` is where requests go when the instance's public address can't be reached from here */
export function createAdminClient(instance: string, token: () => Promise<string>, reachAt = instance): AdminClient {
  const base = `${reachAt}/api/v1/admin`
  const doFetch = async (path: string, init: RequestInit = {}) => {
    const headers = new Headers(init.headers)
    headers.set('authorization', `Bearer ${await token()}`)
    return fetch(base + path, { ...init, headers, signal: init.signal ?? AbortSignal.timeout(15_000) })
  }
  const call = async <T>(method: string, path: string, body?: unknown) => {
    const res = await doFetch(path, {
      method,
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    if (!res.ok) throw await errorOf(res, `${method} ${path}`)
    const text = await res.text()
    return (text ? JSON.parse(text) : null) as T
  }
  return {
    fetch: doFetch,
    get: (path) => call('GET', path),
    post: (path, body) => call('POST', path, body ?? {}),
    put: (path, body) => call('PUT', path, body ?? {}),
    patch: (path, body) => call('PATCH', path, body ?? {}),
    delete: (path) => call('DELETE', path),
  }
}

export async function errorOf(res: Response, what: string) {
  const text = await res.text().catch(() => '')
  let message = text.slice(0, 500) || res.statusText
  let code: string | undefined
  try {
    const body = JSON.parse(text) as { message?: string; data?: { code?: string; error?: string } }
    message = body.message ?? message
    code = body.data?.code ?? body.data?.error
  } catch {
    // not JSON
  }
  return new ShopnexError(res.status, `${what}: ${res.status} ${message}`, code)
}

/**
 * Per-shop storage for the app, kept in the shop's Shopnex and readable only with the app's own token: settings,
 * provider API keys… Values are JSON (64 KB each, 100 keys per shop). Secrets are encrypted with a key derived
 * from the app's private key before they leave the app, so they're unreadable in the Shopnex database
 * (rotating the app key makes stored secrets unreadable: merchants enter them again).
 */
export type AppData = {
  get<T = unknown>(key: string): Promise<T | null>
  set(key: string, value: unknown): Promise<void>
  delete(key: string): Promise<void>
  getSecret(key: string): Promise<string | null>
  setSecret(key: string, value: string): Promise<void>
}

const SECRET_PREFIX = 'enc:v1:'

/** Plain JSON key-value storage; `createAppData` adds secrets on top of any of these */
export type KeyValue = Pick<AppData, 'get' | 'set' | 'delete'>

/** The default backend: the shop's own storage in Shopnex (Admin API) */
export function remoteKeyValue(admin: AdminClient): KeyValue {
  const path = (key: string) => `/app-data/${encodeURIComponent(key)}`
  return {
    async get<T>(key: string) {
      try {
        return (await admin.get<{ value: T }>(path(key))).value
      } catch (error) {
        if (error instanceof ShopnexError && error.status === 404) return null
        throw error
      }
    },
    async set(key, value) {
      await admin.put(path(key), { value })
    },
    async delete(key) {
      try {
        await admin.delete(path(key))
      } catch (error) {
        if (!(error instanceof ShopnexError && error.status === 404)) throw error
      }
    },
  }
}

export function createAppData(kv: KeyValue, cipher: Promise<CryptoKey>): AppData {
  const data: AppData = {
    ...kv,
    async getSecret(key) {
      const sealed = await data.get<string>(key)
      if (typeof sealed !== 'string' || !sealed.startsWith(SECRET_PREFIX)) return null
      const raw = Uint8Array.from(atob(sealed.slice(SECRET_PREFIX.length)), (c) => c.charCodeAt(0))
      try {
        const plain = await crypto.subtle.decrypt(
          { name: 'AES-GCM', iv: raw.subarray(0, 12), additionalData: encoder.encode(key) },
          await cipher,
          raw.subarray(12),
        )
        return new TextDecoder().decode(plain)
      } catch {
        // Sealed with another app key (rotated): as if it were never set
        return null
      }
    },
    async setSecret(key, value) {
      const iv = crypto.getRandomValues(new Uint8Array(12))
      const sealed = new Uint8Array(
        await crypto.subtle.encrypt(
          { name: 'AES-GCM', iv, additionalData: encoder.encode(key) },
          await cipher,
          encoder.encode(value),
        ),
      )
      const raw = new Uint8Array(12 + sealed.length)
      raw.set(iv)
      raw.set(sealed, 12)
      let binary = ''
      for (const b of raw) binary += String.fromCharCode(b)
      await data.set(key, SECRET_PREFIX + btoa(binary))
    },
  }
  return data
}

const encoder = new TextEncoder()

/** AES-256-GCM key for app data secrets, derived (HKDF) from the app's private key */
export async function deriveDataKey(privateKey: string) {
  const material = await crypto.subtle.importKey('raw', encoder.encode(privateKey), 'HKDF', false, ['deriveKey'])
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(), info: encoder.encode('shopnex-app-data-v1') },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

// A small typed fetch wrapper over the ShopNex Admin API (/api/v1/admin/*), authenticated with an API token.
// The server never holds more power than the token: a token without write scopes simply can't change anything.

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

export type Query = Record<string, string | number | boolean | undefined>

export type ShopnexClient = {
  get<T = unknown>(path: string, query?: Query): Promise<T>
  send<T = unknown>(method: 'POST' | 'PATCH' | 'PUT' | 'DELETE', path: string, body?: unknown): Promise<T>
}

export type ClientOptions = {
  /** The instance, e.g. https://shop.example.com or http://localhost:3000 */
  url: string
  /** Admin API token (sk_…) from Settings → API tokens */
  token: string
  fetch?: typeof fetch
}

const REQUEST_TIMEOUT_MS = 30_000

/** What went wrong, in words the model can act on */
async function failure(res: Response) {
  const text = await res.text().catch(() => '')
  let detail = text.slice(0, 300)
  try {
    const json = JSON.parse(text) as { message?: unknown }
    if (typeof json.message === 'string') detail = json.message
  } catch {
    // not JSON: keep the text
  }
  if (res.status === 401)
    return new ApiError(401, 'The API token was rejected. Check SHOPNEX_TOKEN (Settings → API tokens).')
  if (res.status === 403) return new ApiError(403, detail || 'The API token does not have the scope this needs.')
  if (res.status === 404) return new ApiError(404, detail || 'Not found.')
  return new ApiError(res.status, detail || res.statusText)
}

export function createClient({ url, token, fetch: doFetch = fetch }: ClientOptions): ShopnexClient {
  const base = `${url.replace(/\/+$/, '')}/api/v1/admin`
  const call = async (method: string, path: string, query?: Query, body?: unknown) => {
    const qs = new URLSearchParams()
    for (const [k, v] of Object.entries(query ?? {})) if (v !== undefined) qs.set(k, String(v))
    const res = await doFetch(`${base}${path}${qs.size ? `?${qs}` : ''}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        ...(body !== undefined && { 'Content-Type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
    if (!res.ok) throw await failure(res)
    const text = await res.text()
    return text ? JSON.parse(text) : null
  }
  return {
    get: (path, query) => call('GET', path, query),
    send: (method, path, body) => call(method, path, undefined, body),
  } as ShopnexClient
}

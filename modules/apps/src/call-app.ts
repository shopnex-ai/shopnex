// The one way ShopNex's server calls an app (payments, shipping rates, AI, the installed call). What every call needs is decided
// here, so a new kind of call can't forget it: the address is checked, a redirect is never followed, the wait is bounded, and so
// is how much of the answer is read. The caller signs its own request (each kind has its own signature) and reads the answer.
import { isMultiTenant } from '@shopnex/tenancy'
import { assertPublicHost } from '@shopnex/webhooks/network'
import { serverUrl } from './internal-url'

/** What an app may answer with: more than this is not read */
export const MAX_APP_RESPONSE_BYTES = 1_000_000

export interface AppResponse {
  ok: boolean
  status: number
  statusText: string
  text: string
}

async function readText(res: Response, maxBytes: number) {
  const declared = Number(res.headers.get('content-length'))
  if (declared > maxBytes) throw new Error('The answer is too large')
  if (!res.body) return ''
  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > maxBytes) {
      await reader.cancel()
      throw new Error('The answer is too large')
    }
    chunks.push(value)
  }
  return Buffer.concat(chunks).toString('utf8')
}

/**
 * POSTs `body` to an app's address and gives back its answer (an error status is an answer, not an exception; an unreachable
 * app, a timeout or a too large answer throw).
 *
 * In multi-tenant mode an app's address was chosen by someone who is not the operator (a marketplace listing, a developer), so
 * it must not lead into the platform's own network. An address the operator named in its own configuration (serverUrl swaps it
 * for the internal one) is the operator's choice and is not checked. With one shop the operator is the merchant: any address.
 */
export async function callApp(
  url: string,
  init: { headers: Record<string, string>; body: string; timeoutMs: number; maxBytes?: number },
): Promise<AppResponse> {
  const target = serverUrl(url)
  if (isMultiTenant && target === url) await assertPublicHost(new URL(url))
  const res = await fetch(target, {
    method: 'POST',
    headers: init.headers,
    body: init.body,
    // A redirect isn't an answer, and following it would also bypass the address check
    redirect: 'manual',
    signal: AbortSignal.timeout(init.timeoutMs),
  })
  return {
    ok: res.ok,
    status: res.status,
    statusText: res.statusText,
    text: await readText(res, init.maxBytes ?? MAX_APP_RESPONSE_BYTES),
  }
}

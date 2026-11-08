// The one way ShopNex's server calls an app (payment sessions and refunds, carrier rates, AI runs): a signed POST that
// is sent to the address the server can reach, never follows a redirect, gives up after a timeout, refuses an answer
// bigger than it expects, and turns a failure into a readable error. Each kind used to carry its own copy and the copies
// had drifted (only carrier capped the answer, only AI read the app's own error message, AI skipped the internal address).
import type { Signer } from '@shopnex/marketplace-sdk/keys'
import { serverUrl } from './internal-url'
import { instanceSigner } from './keys'

/**
 * Far more than any answer these calls expect (page content, the largest, is capped at 500 KB), so a runaway or hostile
 * app can't make the server read without end.
 */
export const DEFAULT_MAX_BYTES = 1024 * 1024

// An error answer is only read for its first words
const ERROR_BYTES = 8 * 1024

export type CallAppOptions = {
  /** Unique per call: sent as `webhook-id`, so an app can tell a repeat */
  id: string
  /** The exact JSON text to send: it is what gets signed */
  body: string
  /** The kind's signing function (adds its user agent): signPaymentsRequest, signRatesRequest, signAiRequest */
  sign: (signer: Signer, id: string, body: string) => Promise<Record<string, string>>
  timeoutMs: number
  /** Refuse an answer bigger than this (default 1 MiB) */
  maxBytes?: number
  /** The app must answer JSON. Without this an empty or non-JSON answer is just `null`. */
  requireJson?: boolean
  /** A message the app gave for a failure, taken out of its answer; otherwise the status and the start of the answer */
  errorFrom?: (text: string) => string | null
}

async function readText(res: Response, maxBytes: number, truncate: boolean) {
  const declared = Number(res.headers.get('content-length'))
  if (!truncate && Number.isFinite(declared) && declared > maxBytes) {
    await res.body?.cancel().catch(() => {})
    throw new Error('The answer is too large')
  }
  if (!res.body) return ''
  const reader = res.body.getReader()
  const chunks: Buffer[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    if (size + value.byteLength > maxBytes) {
      await reader.cancel().catch(() => {})
      if (!truncate) throw new Error('The answer is too large')
      // Only the start is wanted: keep what fits of this chunk
      chunks.push(Buffer.from(value.subarray(0, maxBytes - size)))
      break
    }
    size += value.byteLength
    chunks.push(Buffer.from(value))
  }
  return Buffer.concat(chunks).toString('utf8')
}

/**
 * Sends `body` to the app at `url`, signed with this instance's key (the app checks it against the keys the
 * instance publishes). Returns the parsed JSON answer, or null when there is none worth parsing. Throws with a message
 * fit to show staff when the app is unreachable, slow, answers an error, or answers too much.
 */
export async function callApp(
  url: string,
  { id, body, sign, timeoutMs, maxBytes = DEFAULT_MAX_BYTES, requireJson = false, errorFrom }: CallAppOptions,
): Promise<unknown> {
  const res = await fetch(serverUrl(url), {
    method: 'POST',
    headers: await sign(await instanceSigner(), id, body),
    body,
    redirect: 'manual',
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (!res.ok) {
    const text = await readText(res, ERROR_BYTES, true).catch(() => '')
    throw new Error(errorFrom?.(text) ?? `${res.status} ${text.slice(0, 300) || res.statusText}`)
  }
  const text = await readText(res, maxBytes, false)
  try {
    return JSON.parse(text) as unknown
  } catch {
    if (requireJson) throw new Error('The app answered something other than JSON')
    return null
  }
}

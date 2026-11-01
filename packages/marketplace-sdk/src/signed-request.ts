// Requests a Shopnex instance sends to an app (payment sessions, AI capability runs), signed like Standard
// Webhooks with an asymmetric key (webhook-id / webhook-timestamp / webhook-signature: v1a,…): the instance
// signs with its own Ed25519 key; the app checks it against the keys the instance named in the body's `instance`
// publishes (createJwksResolver). Nothing per install is shared. WebCrypto only.
import { sign, verify, type KeyResolver, type Signer } from './keys'

const KEY_ID_HEADER = 'shopnex-key-id'

/** Instance side: headers for one request with this exact body */
export async function signInstanceRequest(
  signer: Signer,
  id: string,
  body: string,
  userAgent: string,
  now = new Date(),
) {
  const timestamp = String(Math.floor(now.getTime() / 1000))
  return {
    'content-type': 'application/json',
    'user-agent': userAgent,
    'webhook-id': id,
    'webhook-timestamp': timestamp,
    'webhook-signature': 'v1a,' + (await sign(signer.key, `${id}.${timestamp}.${body}`)),
    [KEY_ID_HEADER]: signer.kid,
  }
}

/**
 * App side: checks the signature (with the keys of the instance the body names) and that it's under 5 minutes
 * old, and returns the parsed body, or null. Pass the raw body text, not re-serialized JSON.
 */
export async function verifyInstanceRequest<T extends { instance: string }>(
  headers: Headers,
  body: string,
  { keys, toleranceSeconds = 300 }: { keys: KeyResolver; toleranceSeconds?: number },
): Promise<T | null> {
  const id = headers.get('webhook-id')
  const timestamp = headers.get('webhook-timestamp')
  const signatures = headers.get('webhook-signature')
  if (!id || !timestamp || !signatures) return null
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > toleranceSeconds) return null
  let request: T
  try {
    request = JSON.parse(body) as T
  } catch {
    return null
  }
  // The body is only trusted once the instance it names has signed it
  if (typeof request?.instance !== 'string') return null
  const key = await keys(request.instance, headers.get(KEY_ID_HEADER) ?? undefined)
  if (!key) return null
  const message = `${id}.${timestamp}.${body}`
  for (const s of signatures.split(' ')) {
    if (s.startsWith('v1a,') && (await verify(key, message, s.slice(4)))) return request
  }
  return null
}

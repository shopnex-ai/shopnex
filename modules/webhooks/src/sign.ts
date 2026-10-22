// Standard Webhooks (https://www.standardwebhooks.com) signing, so receivers can verify with any
// of its libraries: HMAC-SHA256 over `${id}.${timestamp}.${body}`, keyed with the secret's bytes.
import { createHmac, randomBytes } from 'node:crypto'

const SECRET_PREFIX = 'whsec_'

export function generateSecret() {
  return SECRET_PREFIX + randomBytes(24).toString('base64')
}

export function sign(secret: string, id: string, timestamp: number, body: string) {
  const key = Buffer.from(secret.slice(SECRET_PREFIX.length), 'base64')
  return 'v1,' + createHmac('sha256', key).update(`${id}.${timestamp}.${body}`).digest('base64')
}

// Headers for one attempt; the timestamp (and so the signature) changes on every retry
export function signedHeaders(secret: string, id: string, body: string, now = new Date()) {
  const timestamp = Math.floor(now.getTime() / 1000)
  return {
    'content-type': 'application/json',
    'user-agent': 'Shopnex-Webhooks/1.0',
    'webhook-id': id,
    'webhook-timestamp': String(timestamp),
    'webhook-signature': sign(secret, id, timestamp, body),
  }
}

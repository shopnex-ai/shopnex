// S3-compatible buckets: AWS S3, Cloudflare R2, DigitalOcean Spaces, Backblaze B2, MinIO… Requests are
// signed with aws4fetch (SigV4) rather than the AWS SDK, which also avoids the SDK's default upload
// checksums that several S3-compatible services reject.
import { AwsClient } from 'aws4fetch'
import type { S3Config } from '@shopnex/db/schema'
import { isMultiTenant } from '@shopnex/tenancy'
import { assertPublicHost } from '@shopnex/webhooks/network'
import { FilesError } from './errors'
import type { StorageProvider } from './storage'

const trimSlash = (url: string) => url.replace(/\/+$/, '')

export function objectUrl(config: S3Config, key: string) {
  const endpoint = new URL(config.endpoint)
  return config.forcePathStyle
    ? `${trimSlash(endpoint.href)}/${config.bucket}/${key}`
    : `${endpoint.protocol}//${config.bucket}.${endpoint.host}/${key}`
}

export const publicFileUrl = (config: S3Config, key: string) => `${trimSlash(config.publicUrl)}/${key}`

// S3 errors are XML: <Error><Code>AccessDenied</Code><Message>…</Message></Error>
async function describeError(res: Response) {
  const body = await res.text().catch(() => '')
  const code = body.match(/<Code>([^<]+)<\/Code>/)?.[1]
  const message = body.match(/<Message>([^<]+)<\/Message>/)?.[1]
  return [`HTTP ${res.status}`, code, message].filter(Boolean).join(': ')
}

export function s3Provider(name: string, config: S3Config, secretAccessKey: string): StorageProvider {
  const client = new AwsClient({
    accessKeyId: config.accessKeyId,
    secretAccessKey,
    service: 's3',
    region: config.region || 'auto',
  })

  const send = async (key: string, init: RequestInit) => {
    const url = new URL(objectUrl(config, key))
    // The endpoint is typed in by the merchant: keep it off the platform's network in multi-tenant mode
    if (isMultiTenant) await assertPublicHost(url)
    // A redirect would skip that check (and S3 only redirects for a wrong region or endpoint)
    return client.fetch(url, { ...init, redirect: 'manual', signal: AbortSignal.timeout(30_000) })
  }

  return {
    name,
    async put(key, body, contentType) {
      const res = await send(key, {
        method: 'PUT',
        body,
        headers: {
          'Content-Type': contentType,
          'Cache-Control': 'public, max-age=31536000, immutable',
          ...(config.publicAcl && { 'x-amz-acl': 'public-read' }),
        },
      })
      if (!res.ok)
        throw new FilesError('STORAGE_FAILED', `Could not upload to the bucket (${await describeError(res)})`)
    },
    async delete(key) {
      const res = await send(key, { method: 'DELETE' })
      if (!res.ok && res.status !== 404) {
        throw new FilesError('STORAGE_FAILED', `Could not delete from the bucket (${await describeError(res)})`)
      }
    },
    url: (key) => publicFileUrl(config, key),
  }
}

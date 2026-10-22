import { storageService } from '@shopnex/files'
import { shopManager } from '../../orpc'
import { s3Input, storageInput } from './schemas'

// Settings → Storage: where new uploads go (the server's disk, or an S3-compatible bucket). Owners and
// admins only; the secret key is write-only.
export const storage = {
  get: shopManager
    .route({ method: 'GET', path: '/admin/storage' })
    .handler(({ context }) => storageService.getSettings(context.shop.id)),
  // Switching to a bucket runs the connection test first and fails if any step does
  update: shopManager
    .route({ method: 'PUT', path: '/admin/storage' })
    .input(storageInput)
    .handler(({ input, context }) =>
      input.provider === 'local'
        ? storageService.useLocal(context.shop.id)
        : storageService.useS3(context.shop.id, {
            ...input.s3,
            secretAccessKey: input.s3.secretAccessKey || undefined,
          }),
    ),
  // Upload, public load and delete of a small test file, without saving anything
  test: shopManager
    .route({ method: 'POST', path: '/admin/storage/test' })
    .input(s3Input)
    .handler(({ input, context }) =>
      storageService.testS3(context.shop.id, { ...input, secretAccessKey: input.secretAccessKey || undefined }),
    ),
}

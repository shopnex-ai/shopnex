import { ORPCError } from '@orpc/server'
import { z } from 'zod'
import { db } from '@shopnex/db'
import { createProcedures, pagination } from '@shopnex/rpc'
import * as storageService from './backends'
import {
  fileListOutput,
  fileOutput,
  s3Input,
  storageInput,
  storageSettingsOutput,
  storageTestOutput,
} from './files.contract'
import * as fileService from './files'

const { admin, shopManager } = createProcedures()

// A blank secret key means "keep the one already saved"
const keepSaved = (secret: string | undefined) => (secret === '' ? undefined : secret)

// Content → Files: the shop's uploaded images. Staff only for now; a read/write_files scope for apps later.
export const files = {
  list: admin
    .route({ method: 'GET', path: '/admin/files' })
    .output(fileListOutput)
    .input(pagination)
    .handler(async ({ input, context }) => {
      const [items, total] = await Promise.all([
        fileService.list(context.shop.id, input, db),
        fileService.count(context.shop.id, db),
      ])
      return { items, total }
    }),
  // multipart/form-data; the type is checked from the bytes (JPEG, PNG, GIF, WebP, AVIF)
  upload: admin
    .route({ method: 'POST', path: '/admin/files' })
    .output(fileOutput)
    .input(z.object({ file: z.file(), alt: z.string().max(300).nullish() }))
    .handler(({ input, context }) => fileService.upload(context.shop.id, input.file, { alt: input.alt }, db)),
  delete: admin
    .route({ method: 'DELETE', path: '/admin/files/{id}' })
    .output(fileOutput)
    .input(z.object({ id: z.uuid() }))
    .handler(async ({ input, context }) => {
      const row = await fileService.remove(context.shop.id, input.id, db)
      if (!row) throw new ORPCError('NOT_FOUND')
      return row
    }),
}

// Settings → Storage: where new uploads go (the server's disk, or an S3-compatible bucket). Owners and
// admins only; the secret key is write-only.
export const storage = {
  get: shopManager
    .route({ method: 'GET', path: '/admin/storage' })
    .output(storageSettingsOutput)
    .handler(({ context }) => storageService.getSettings(context.shop.id, db)),
  // Switching to a bucket runs the connection test first and fails if any step does
  update: shopManager
    .route({ method: 'PUT', path: '/admin/storage' })
    .output(storageSettingsOutput)
    .input(storageInput)
    .handler(({ input, context }) =>
      input.provider === 'local'
        ? storageService.useLocal(context.shop.id, db)
        : storageService.useS3(
            context.shop.id,
            { ...input.s3, secretAccessKey: keepSaved(input.s3.secretAccessKey) },
            db,
          ),
    ),
  // Upload, public load and delete of a small test file, without saving anything
  test: shopManager
    .route({ method: 'POST', path: '/admin/storage/test' })
    .output(storageTestOutput)
    .input(s3Input)
    .handler(({ input, context }) =>
      storageService.testS3(context.shop.id, { ...input, secretAccessKey: keepSaved(input.secretAccessKey) }, db),
    ),
}

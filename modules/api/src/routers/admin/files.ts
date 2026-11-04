import { ORPCError } from '@orpc/server'
import { z } from 'zod'
import { fileService } from '@shopnex/files'
import { admin } from '../../orpc'
import { pagination } from '../pagination'
import { fileListOutput, fileOutput } from './outputs'

// Content → Files: the shop's uploaded images. Staff only for now; a read/write_files scope for apps later.
export const files = {
  list: admin
    .route({ method: 'GET', path: '/admin/files' })
    .output(fileListOutput)
    .input(pagination)
    .handler(async ({ input, context }) => {
      const [items, total] = await Promise.all([
        fileService.list(context.shop.id, input),
        fileService.count(context.shop.id),
      ])
      return { items, total }
    }),
  // multipart/form-data; the type is checked from the bytes (JPEG, PNG, GIF, WebP, AVIF)
  upload: admin
    .route({ method: 'POST', path: '/admin/files' })
    .output(fileOutput)
    .input(z.object({ file: z.file(), alt: z.string().max(300).nullish() }))
    .handler(({ input, context }) => fileService.upload(context.shop.id, input.file, { alt: input.alt })),
  delete: admin
    .route({ method: 'DELETE', path: '/admin/files/{id}' })
    .output(fileOutput)
    .input(z.object({ id: z.uuid() }))
    .handler(async ({ input, context }) => {
      const row = await fileService.remove(context.shop.id, input.id)
      if (!row) throw new ORPCError('NOT_FOUND')
      return row
    }),
}

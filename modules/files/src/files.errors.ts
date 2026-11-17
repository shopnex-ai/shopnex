import { defineError, type ErrorCode } from '@shopnex/kit'

// Domain error; every code is the caller's to fix, so the Admin API answers 400
export const FilesError = defineError('FilesError', {
  FILE_TOO_LARGE: 'BAD_REQUEST',
  UNSUPPORTED_TYPE: 'BAD_REQUEST',
  STORAGE_FAILED: 'BAD_REQUEST',
  SECRET_REQUIRED: 'BAD_REQUEST',
})
export type FilesError = InstanceType<typeof FilesError>
export type FilesErrorCode = ErrorCode<typeof FilesError>

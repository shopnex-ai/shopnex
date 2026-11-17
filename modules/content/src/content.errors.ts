import { defineError, type ErrorCode } from '@shopnex/kit'

// Domain error; each code's status is the one the Admin API answers with
export const ContentError = defineError('ContentError', {
  MENU_NOT_FOUND: 'NOT_FOUND',
  PAGE_NOT_FOUND: 'NOT_FOUND',
  HANDLE_TAKEN: 'CONFLICT',
  RESOURCE_NOT_FOUND: 'BAD_REQUEST',
})
export type ContentError = InstanceType<typeof ContentError>
export type ContentErrorCode = ErrorCode<typeof ContentError>

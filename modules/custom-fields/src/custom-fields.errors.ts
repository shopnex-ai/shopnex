import { defineError, type ErrorCode } from '@shopnex/kit'

// Domain error; each code's status is the one the Admin API answers with (the storefront maps it on its own)
export const CustomFieldError = defineError('CustomFieldError', {
  FIELD_NOT_FOUND: 'NOT_FOUND',
  KEY_TAKEN: 'CONFLICT',
  // A value for a key that has no definition, or of the wrong type
  INVALID_VALUE: 'BAD_REQUEST',
})
export type CustomFieldError = InstanceType<typeof CustomFieldError>
export type CustomFieldErrorCode = ErrorCode<typeof CustomFieldError>

import { defineError, type ErrorCode } from '@shopnex/kit'

// Domain error; each code's status is the one the Admin API answers with
export const EmailError = defineError('EmailError', {
  EMAIL_FAILED: 'BAD_REQUEST',
  EMAIL_OFF: 'BAD_REQUEST',
  INVALID_TEMPLATE: 'BAD_REQUEST',
  PASSWORD_REQUIRED: 'BAD_REQUEST',
  // An app may only write to people who are customers of the shop, and only so often
  RECIPIENT_UNKNOWN: 'BAD_REQUEST',
  SEND_LIMIT: 'TOO_MANY_REQUESTS',
})
export type EmailError = InstanceType<typeof EmailError>
export type EmailErrorCode = ErrorCode<typeof EmailError>

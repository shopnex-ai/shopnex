import { defineError, type ErrorCode } from '@shopnex/kit'

// Domain error; each code's status is the one the Admin API answers with
export const DomainError = defineError('DomainError', {
  INVALID_DOMAIN: 'BAD_REQUEST',
  DOMAIN_TAKEN: 'CONFLICT',
  DOMAIN_NOT_FOUND: 'NOT_FOUND',
})
export type DomainError = InstanceType<typeof DomainError>
export type DomainErrorCode = ErrorCode<typeof DomainError>

// Domain error of the staff of a shop; its codes are also the statuses they answer with (the ones of oRPC)
export const StaffError = defineError('StaffError', {
  NOT_FOUND: 'NOT_FOUND',
  ALREADY_MEMBER: 'CONFLICT',
  FORBIDDEN: 'FORBIDDEN',
})
export type StaffError = InstanceType<typeof StaffError>
export type StaffErrorCode = ErrorCode<typeof StaffError>

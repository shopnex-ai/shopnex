import { defineError, type ErrorCode } from '@shopnex/kit'

// Domain error; each code's status is the one the Admin API answers with
export const ChannelError = defineError('ChannelError', {
  CHANNEL_NOT_FOUND: 'NOT_FOUND',
  HANDLE_TAKEN: 'CONFLICT',
  CHANNEL_PROTECTED: 'CONFLICT',
  CHANNEL_IN_USE: 'CONFLICT',
})
export type ChannelError = InstanceType<typeof ChannelError>
export type ChannelErrorCode = ErrorCode<typeof ChannelError>

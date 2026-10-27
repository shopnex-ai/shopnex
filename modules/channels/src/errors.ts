export type ChannelErrorCode = 'CHANNEL_NOT_FOUND' | 'HANDLE_TAKEN' | 'CHANNEL_PROTECTED' | 'CHANNEL_IN_USE'

export class ChannelError extends Error {
  constructor(
    readonly code: ChannelErrorCode,
    message: string,
  ) {
    super(message)
  }
}

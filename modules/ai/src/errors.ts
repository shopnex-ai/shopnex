export type AiErrorCode =
  // configure: the caller isn't an installed app, or a URL isn't on the app's own origin
  | 'NOT_AN_AI_APP'
  | 'INVALID_PROVIDER_URL'
  // No installed app provides this capability for the shop (or not the app asked for)
  | 'CAPABILITY_UNAVAILABLE'
  | 'SUBJECT_NOT_FOUND'
  | 'GENERATION_NOT_FOUND'
  // The app failed, timed out or answered something that doesn't match the capability's output
  | 'PROVIDER_FAILED'

// Domain error; the API layer maps it to an HTTP error
export class AiError extends Error {
  constructor(
    readonly code: AiErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'AiError'
  }
}

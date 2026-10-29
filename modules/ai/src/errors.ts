export type AiErrorCode =
  // configure: the caller isn't an installed app, or a URL isn't on the app's own origin
  | 'NOT_AN_AI_APP'
  | 'INVALID_PROVIDER_URL'
  // Neither built-in AI nor an installed app provides this capability for the shop (or not the one asked for)
  | 'CAPABILITY_UNAVAILABLE'
  | 'SUBJECT_NOT_FOUND'
  // The capability is about a product or collection and none was given
  | 'SUBJECT_REQUIRED'
  | 'GENERATION_NOT_FOUND'
  // The provider (built in or an app) failed, timed out or answered something that doesn't match the output
  | 'PROVIDER_FAILED'
  // Settings → AI: no key to use, or the provider refused the key or model
  | 'KEY_REQUIRED'
  | 'INVALID_PROVIDER_KEY'

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

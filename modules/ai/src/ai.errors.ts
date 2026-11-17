import { defineError, type ErrorCode } from '@shopnex/kit'

// Domain error; each code's status is the one the Admin API answers with
export const AiError = defineError('AiError', {
  // configure: the caller isn't an installed app, or a URL isn't on the app's own origin
  NOT_AN_AI_APP: 'FORBIDDEN',
  INVALID_PROVIDER_URL: 'BAD_REQUEST',
  // Neither built-in AI nor an installed app provides this capability for the shop (or not the one asked for)
  CAPABILITY_UNAVAILABLE: 'BAD_REQUEST',
  SUBJECT_NOT_FOUND: 'NOT_FOUND',
  // The capability is about a product or collection and none was given
  SUBJECT_REQUIRED: 'BAD_REQUEST',
  GENERATION_NOT_FOUND: 'NOT_FOUND',
  // The provider (built in or an app) failed, timed out or answered something that doesn't match the output
  PROVIDER_FAILED: 'BAD_GATEWAY',
  // Settings → AI: no key to use, or the provider refused the key or model
  KEY_REQUIRED: 'BAD_REQUEST',
  INVALID_PROVIDER_KEY: 'BAD_REQUEST',
})
export type AiError = InstanceType<typeof AiError>
export type AiErrorCode = ErrorCode<typeof AiError>

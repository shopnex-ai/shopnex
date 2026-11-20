import { defineError, type ErrorCode } from '@shopnex/kit'

// Domain error; each code's status is the one the Admin API answers with (the storefront maps it on its own)
export const LanguageError = defineError('LanguageError', {
  // Translating into a language the shop has not published (or into its default one, which is the text itself)
  LANGUAGE_NOT_PUBLISHED: 'BAD_REQUEST',
  // A field that cannot be translated on that kind of record
  INVALID_FIELD: 'BAD_REQUEST',
  // Too many published languages
  TOO_MANY_LANGUAGES: 'BAD_REQUEST',
})
export type LanguageError = InstanceType<typeof LanguageError>
export type LanguageErrorCode = ErrorCode<typeof LanguageError>

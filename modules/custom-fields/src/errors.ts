export type CustomFieldErrorCode =
  | 'FIELD_NOT_FOUND'
  | 'KEY_TAKEN'
  // A value for a key that has no definition, or of the wrong type
  | 'INVALID_VALUE'

// Domain error; the API layer maps it to an HTTP error
export class CustomFieldError extends Error {
  constructor(
    readonly code: CustomFieldErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'CustomFieldError'
  }
}

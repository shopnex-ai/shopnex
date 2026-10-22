export type EmailErrorCode = 'EMAIL_FAILED' | 'EMAIL_OFF' | 'INVALID_TEMPLATE' | 'PASSWORD_REQUIRED'

// Domain error; the API layer maps it to an HTTP error
export class EmailError extends Error {
  constructor(
    readonly code: EmailErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'EmailError'
  }
}

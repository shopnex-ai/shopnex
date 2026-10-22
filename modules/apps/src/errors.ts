// Codes follow OAuth 2.0 (RFC 6749) where there is one, so app developers recognise them
export type AppErrorCode =
  | 'APP_NOT_FOUND'
  | 'INSTALLATION_NOT_FOUND'
  | 'MARKETPLACE_NOT_CONNECTED'
  | 'MARKETPLACE_CONNECT_FAILED'
  | 'APP_DATA_TOO_LARGE'
  // authorize: shown on the consent page, never redirected (the redirect target can't be trusted)
  | 'invalid_client'
  | 'invalid_redirect_uri'
  // authorize: redirected back to the app
  | 'invalid_scope'
  // token exchange
  | 'invalid_grant'

export class AppError extends Error {
  constructor(
    public code: AppErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'AppError'
  }
}

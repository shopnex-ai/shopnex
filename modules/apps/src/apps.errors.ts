import { defineError, type ErrorCode } from '@shopnex/kit'

// Codes follow OAuth 2.0 (RFC 6749) where there is one, so app developers recognise them. A response also names the code as `error`,
// which is where OAuth clients look for it (RFC 6749 §5.2).
export const AppError = defineError(
  'AppError',
  {
    APP_NOT_FOUND: 'NOT_FOUND',
    INSTALLATION_NOT_FOUND: 'NOT_FOUND',
    MARKETPLACE_NOT_CONNECTED: 'BAD_REQUEST',
    MARKETPLACE_CONNECT_FAILED: 'BAD_REQUEST',
    APP_DATA_TOO_LARGE: 'BAD_REQUEST',
    // storefront scripts: on the app's own origin only, and not for marketplace apps (until listings are reviewed)
    SCRIPT_URL_INVALID: 'BAD_REQUEST',
    SCRIPTS_NOT_ALLOWED: 'FORBIDDEN',
    // authorize: shown on the consent page, never redirected (the redirect target can't be trusted)
    invalid_client: 'UNAUTHORIZED',
    invalid_redirect_uri: 'BAD_REQUEST',
    // authorize: redirected back to the app
    invalid_scope: 'BAD_REQUEST',
    // token exchange
    invalid_grant: 'BAD_REQUEST',
  },
  { data: (code) => ({ error: code }) },
)
export type AppError = InstanceType<typeof AppError>
export type AppErrorCode = ErrorCode<typeof AppError>

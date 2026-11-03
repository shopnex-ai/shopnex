// What the sign-in page says for the error code Better Auth puts in /admin/login?error=... after a failed OAuth
// sign-in (Google, GitHub). The codes are its messages with underscores ("account not linked").
const RETRY = 'We couldn’t finish signing you in with that provider. Please try again.'
const EXPIRED = 'The sign-in expired or was interrupted. Please try again.'

const MESSAGES: Record<string, string> = {
  // An account with this email exists but was made another way. It isn't linked automatically: its email was never
  // verified, so anyone could have registered it
  account_not_linked:
    'An account with this email already exists. Sign in the way you created it, for example with your email and password.',
  // Our sign-up rules refused the new account (invitation only, or too many sign-ups right now)
  unable_to_create_user:
    'We couldn’t create your account. Sign-up may be by invitation only (ask a shop owner to invite you) or limited for now: try again later.',
  signup_disabled: 'New accounts can’t be created here. Ask a shop owner to invite you.',
  access_denied: 'Sign-in was cancelled.',
  email_not_found: 'That account has no email address we can use. Add a verified email at the provider and try again.',
  state_mismatch: EXPIRED,
  state_not_found: EXPIRED,
  invalid_callback_request: EXPIRED,
  no_code: EXPIRED,
  invalid_code: EXPIRED,
  unable_to_get_user_info: RETRY,
  unable_to_link_account: RETRY,
  unable_to_update_account: RETRY,
  unable_to_create_session: RETRY,
  oauth_provider_not_found: RETRY,
}

export function oauthErrorMessage(code: string) {
  return MESSAGES[code] ?? `Sign in failed: ${code.replaceAll('_', ' ')}`
}

import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { oauthErrorMessage } from '../src/screens/auth/oauth-errors'

describe('oauthErrorMessage', () => {
  test('explains an account that exists but is not linked', () => {
    const message = oauthErrorMessage('account_not_linked')
    assert.match(message, /already exists/)
    assert.doesNotMatch(message, /_/)
  })

  test('says what happened when sign-up is refused or the visitor cancels', () => {
    assert.match(oauthErrorMessage('unable_to_create_user'), /invitation/)
    assert.equal(oauthErrorMessage('access_denied'), 'Sign-in was cancelled.')
  })

  test('an expired or interrupted sign-in asks to try again', () => {
    for (const code of ['state_mismatch', 'state_not_found', 'invalid_callback_request', 'no_code', 'invalid_code']) {
      assert.match(oauthErrorMessage(code), /try again/i, code)
    }
  })

  test('a code it does not know keeps the readable fallback', () => {
    assert.equal(oauthErrorMessage('some_new_error'), 'Sign in failed: some new error')
  })
})

// Credentials: the generated processor list, what's asked for, and Prism's own check of a config (offline).
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { allFields, CONNECTORS, checkCredentials, fieldLabel, fieldsOf, missingFields } from '../src/prism'

describe('credentials', () => {
  test('lists the processors that take cards, with their required fields', () => {
    assert.ok(Object.keys(CONNECTORS).length > 60)
    assert.deepEqual(CONNECTORS.stripe?.required, ['apiKey'])
    assert.deepEqual(CONNECTORS.adyen?.required, ['apiKey', 'merchantAccount'])
  })

  test("leaves out processors that can't take a card, and flags the unverified", () => {
    for (const id of ['affirm', 'cryptopay', 'phonepe', 'kount', 'hyperswitch'])
      assert.equal(CONNECTORS[id], undefined, id)
    assert.equal(CONNECTORS.stripe?.card, 'yes')
    assert.equal(CONNECTORS.braintree?.card, 'unverified')
  })

  test('each processor asks for its required fields first, then the optional ones', () => {
    assert.deepEqual(fieldsOf('stripe'), [{ name: 'apiKey', optional: false }])
    assert.deepEqual(
      fieldsOf('adyen').map((f) => `${f.name}${f.optional ? '?' : ''}`),
      ['apiKey', 'merchantAccount', 'reviewKey?', 'disputeBaseUrl?', 'endpointPrefix?'],
    )
    assert.ok(allFields.includes('merchantAccount'))
  })

  test('missing required fields are named', () => {
    assert.equal(missingFields('adyen', { apiKey: 'k' }), 'Enter Merchant account')
    assert.equal(missingFields('adyen', { apiKey: 'k', merchantAccount: 'm' }), null)
    assert.equal(fieldLabel('apiKey'), 'API key')
  })

  test("Prism's own check catches an incomplete config, and sends nothing", async () => {
    const stripe = { connector: 'stripe', testMode: true }
    assert.equal(await checkCredentials({ ...stripe, values: { apiKey: 'sk_test_1' } }), null)
    assert.match((await checkCredentials({ ...stripe, values: {} })) ?? '', /some are missing/)
    assert.match(
      (await checkCredentials({ connector: 'adyen', testMode: true, values: { apiKey: 'k' } })) ?? '',
      /Adyen/,
    )
  })
})

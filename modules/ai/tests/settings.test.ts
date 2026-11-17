// Settings → AI, without calling the provider: what is shown (never the key), what saving needs, and when built-in AI answers.
// Saving a key checks it with the provider first, so a saved row is made here directly.
import assert from 'node:assert/strict'
import { after, before, beforeEach, describe, test } from 'node:test'
import * as fx from './fixtures'

const { db, schema, SHOP } = fx
const { aiSettingsService } = await import('../src')
const { AiError } = await import('../src/ai.errors')
const { decryptSecret, encryptSecret } = await import('@shopnex/db/secrets')
const { eq } = await import('drizzle-orm')

const refused = (code: string) => (e: unknown) => e instanceof AiError && e.code === code
const row = async () => (await db.select().from(schema.aiSettings).where(eq(schema.aiSettings.shopId, SHOP)))[0]
const saved = (patch: Partial<typeof schema.aiSettings.$inferInsert> = {}) =>
  db.insert(schema.aiSettings).values({
    shopId: SHOP,
    provider: 'anthropic',
    model: 'claude-sonnet-5-5',
    brandVoice: 'Friendly',
    apiKey: encryptSecret('sk-secret-key'),
    ...patch,
  })

before(fx.prepareDatabase)
beforeEach(fx.cleanup)
after(fx.cleanup)

describe('settings', () => {
  test('with nothing saved: no settings, and the providers staff can pick', async () => {
    const { settings, providers } = await aiSettingsService.getSettings(SHOP)
    assert.equal(settings, null)
    assert.deepEqual(
      providers.map((p) => [p.id, p.name]),
      [
        ['anthropic', 'Claude'],
        ['openai', 'OpenAI'],
      ],
    )
  })

  test('saved settings are shown without the key', async () => {
    await saved()
    const { settings } = await aiSettingsService.getSettings(SHOP)
    assert.deepEqual(settings, {
      provider: 'anthropic',
      model: 'claude-sonnet-5-5',
      brandVoice: 'Friendly',
      enabled: true,
    })
    assert.ok(!JSON.stringify(await aiSettingsService.getSettings(SHOP)).includes('sk-secret-key'))
  })

  test('the key is stored encrypted', async () => {
    await saved()
    const stored = (await row())!.apiKey
    assert.notEqual(stored, 'sk-secret-key')
    assert.equal(decryptSecret(stored), 'sk-secret-key')
  })

  test('saving needs a key: none saved, or the provider changed without a new one', async () => {
    await assert.rejects(aiSettingsService.save(SHOP, { provider: 'anthropic' }), refused('KEY_REQUIRED'))
    await saved()
    await assert.rejects(aiSettingsService.save(SHOP, { provider: 'openai' }), refused('KEY_REQUIRED'))
    assert.equal((await row())!.provider, 'anthropic', 'nothing changed')
  })

  test('turning it off keeps the key and the rest, and stops it answering', async () => {
    await saved()
    assert.ok(await aiSettingsService.active(SHOP))
    const { settings } = await aiSettingsService.turnOff(SHOP)
    assert.equal(settings?.enabled, false)
    assert.equal(decryptSecret((await row())!.apiKey), 'sk-secret-key')
    assert.equal(await aiSettingsService.active(SHOP), null)
  })

  test('active: nothing saved answers nothing; saved and on is named for its provider', async () => {
    assert.equal(await aiSettingsService.active(SHOP), null)
    await saved({ provider: 'openai', model: 'gpt-6.1-sol' })
    assert.equal((await aiSettingsService.active(SHOP))?.name, 'OpenAI')
  })

  test('settings are per shop', async () => {
    await saved()
    assert.equal((await aiSettingsService.getSettings('another-shop')).settings, null)
    assert.equal(await aiSettingsService.active('another-shop'), null)
  })
})

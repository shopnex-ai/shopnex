// AI for Shopnex: a bundled AI app on @shopnex/app. Provides product descriptions and SEO listings (Shopnex AI
// capabilities) with the merchant's own Anthropic or OpenAI key. Runs next to Shopnex (its own process) and keeps
// its data in DATA_DIR (SQLite): the provider keys are stored there, encrypted with this app's key.
//
//   GET  /                Embedded settings page (session token)
//   POST /api/settings    Save provider, key, model and brand voice; register the capabilities with Shopnex
//   POST /api/disconnect  Stop providing capabilities and delete the keys
//   POST /ai/run          Shopnex: run a capability (signed AiRunRequest) → AiRunResponse
import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { createShopnexApp, type ShopContext } from '@shopnex/app'
import { openLocalStore } from '@shopnex/app/store'
import * as claude from './claude'
import * as openai from './openai'
import { GenerationError, type Settings } from './prompts'
import { icon, PROVIDERS, SettingsPage } from './settings'

const env = (name: string) => {
  const value = process.env[name]
  if (!value) throw new Error(`Missing ${name} (see .env.example)`)
  return value
}
// Public origin Shopnex and the admin (iframe) reach this app at
const APP_URL = env('AI_APP_URL').replace(/\/$/, '')
// Listens on the URL's port unless the platform sets PORT (behind a proxy the public URL has none)
const PORT = Number(process.env.PORT || new URL(APP_URL).port || 4601)

// The app's identity and the shops' settings live in DATA_DIR (a volume in Docker). Shopnex reads the public key
// from /.well-known/shopnex-app.json (bundled app): see registerBundledApps in @shopnex/apps
const store = await openLocalStore()
const shopnex = createShopnexApp({ clientId: 'app_ai', appKey: store.appKey, data: store.dataFor })

type Provider = Settings['provider']
const providers = {
  anthropic: { ...claude, defaultModel: claude.CLAUDE_MODELS[0]!.value },
  openai: { ...openai, defaultModel: openai.OPENAI_DEFAULT_MODEL },
} satisfies Record<Provider, unknown>

const isProvider = (value: unknown): value is Provider => PROVIDERS.some((p) => p.value === value)
const keyName = (provider: Provider) => `${provider}_api_key`

async function view(shop: ShopContext) {
  const [settings, ...keys] = await Promise.all([
    shop.data.get<Settings>('settings'),
    ...PROVIDERS.map((p) => shop.data.getSecret(keyName(p.value))),
  ])
  return { settings, savedKeys: PROVIDERS.filter((_, i) => keys[i]).map((p) => p.value) }
}

// Both capabilities go to one route; the request names which one it is
const capabilities = { 'product.description': `${APP_URL}/ai/run`, 'product.seo': `${APP_URL}/ai/run` }

const message = (error: unknown) => (error instanceof Error ? error.message : String(error))

const app = new Hono()
app.route('/', shopnex.routes)
app.get('/icon.svg', (c) => c.body(icon, 200, { 'content-type': 'image/svg+xml', 'cache-control': 'max-age=86400' }))

// --- settings (embedded page) ---

app.get('/', async (c) => {
  const shop = await shopnex.authenticate(c)
  return c.html(<SettingsPage {...await view(shop)} />)
})

// Checks the key against the provider with the chosen model, then tells Shopnex what this app provides
app.post('/api/settings', async (c) => {
  const shop = await shopnex.authenticate(c)
  const body = (await c.req.json().catch(() => ({}))) as Partial<Record<keyof Settings | 'apiKey', string>>
  if (!isProvider(body.provider)) return c.json({ error: 'Pick a provider' }, 400)
  const provider = providers[body.provider]
  const current = await shop.data.get<Settings>('settings')
  // A model typed for the other provider makes no sense here: start from this provider's default
  const keptModel = current?.provider === body.provider ? current.model : undefined
  const model = body.model?.trim() || keptModel || provider.defaultModel
  const newKey = body.apiKey?.trim()
  const apiKey = newKey || (await shop.data.getSecret(keyName(body.provider)))
  if (!apiKey)
    return c.json({ error: `Enter your ${body.provider === 'openai' ? 'OpenAI' : 'Anthropic'} API key` }, 400)

  try {
    await provider.verify(apiKey, model)
  } catch (error) {
    return c.json({ error: `Couldn't use ${model} with this key: ${message(error)}` }, 400)
  }
  if (newKey) await shop.data.setSecret(keyName(body.provider), newKey)
  await shop.data.set('settings', {
    provider: body.provider,
    model,
    brandVoice: (body.brandVoice ?? '').trim().slice(0, 1000),
  } satisfies Settings)

  try {
    await shop.ai.configure(capabilities)
  } catch (error) {
    return c.json({ error: `Saved, but Shopnex didn't accept the AI capabilities: ${message(error)}` }, 502)
  }
  return c.json({ message: 'Saved. Generate is on in the product editor.' })
})

app.post('/api/disconnect', async (c) => {
  const shop = await shopnex.authenticate(c)
  await shop.ai.configure({})
  await shop.data.delete('settings')
  await Promise.all(PROVIDERS.map((p) => shop.data.delete(keyName(p.value))))
  return c.json({ message: 'Turned off' })
})

// --- Shopnex → app: capability runs (signed with the instance's key) ---

app.post('/ai/run', async (c) => {
  const { request, shop } = await shopnex.verifyAiRequest(c)
  const settings = await shop.data.get<Settings>('settings')
  const apiKey = settings && (await shop.data.getSecret(keyName(settings.provider)))
  if (!settings || !apiKey) return c.json({ error: 'The AI app is not set up for this shop. Open it in Apps.' }, 409)
  try {
    return c.json(await providers[settings.provider].run(apiKey, settings, request))
  } catch (error) {
    if (error instanceof GenerationError) return c.json({ error: error.message }, 502)
    console.error(`[ai] ${request.capability} ${request.id}:`, error)
    return c.json({ error: 'Something went wrong in the AI app' }, 500)
  }
})

app.onError((error, c) => {
  if (error instanceof HTTPException) return error.getResponse()
  console.error('[ai]', error)
  return c.json({ error: message(error) }, 500)
})

serve({ fetch: app.fetch, port: PORT }, () => console.log(`AI app on ${APP_URL} (port ${PORT})`))

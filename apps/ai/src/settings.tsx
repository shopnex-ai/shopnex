// The settings page, embedded in the Shopnex admin
import { Badge, Banner, Button, Card, Code, Form, Page, Select, Text, TextField } from '@shopnex/app/ui'
import { CLAUDE_MODELS } from './claude'
import { OPENAI_DEFAULT_MODEL } from './openai'
import type { Settings } from './prompts'

export const icon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#7c3aed"/><path fill="#fff" d="M30 14l4.2 11.8L46 30l-11.8 4.2L30 46l-4.2-11.8L14 30l11.8-4.2zM45 12l1.8 4.2L51 18l-4.2 1.8L45 24l-1.8-4.2L39 18l4.2-1.8zM45 40l1.5 3.5L50 45l-3.5 1.5L45 50l-1.5-3.5L40 45l3.5-1.5z"/></svg>`

export const PROVIDERS = [
  { value: 'anthropic', label: 'Anthropic (Claude)' },
  { value: 'openai', label: 'OpenAI' },
] as const

export type SettingsView = { settings: Settings | null; savedKeys: Settings['provider'][] }

export function SettingsPage({ settings, savedKeys }: SettingsView) {
  const provider = settings?.provider ?? 'anthropic'
  const providerLabel = PROVIDERS.find((p) => p.value === provider)!.label
  return (
    <Page
      title="AI"
      subtitle="Product descriptions and search listings written by AI, reviewed by you before they're saved."
      actions={<Badge tone={settings ? 'success' : 'warning'}>{settings ? 'On' : 'Not set up'}</Badge>}
    >
      {settings ? (
        <Banner tone="success" title="✨ Generate is on">
          Using {providerLabel}, {settings.model}. Open any product: Generate sits next to its description and search
          engine listing.
        </Banner>
      ) : (
        <Banner tone="warning" title="Not set up">
          Pick a provider and add its API key below.
        </Banner>
      )}

      <Card
        title="Provider"
        description={
          <>
            Your own API key: generations are billed to your account with the provider. It's stored encrypted and only
            used to write what staff ask for. Get one at <Code>console.anthropic.com</Code> or{' '}
            <Code>platform.openai.com</Code>.
          </>
        }
      >
        <Form action="/api/settings" reload>
          <Select label="Provider" name="provider" value={provider} options={[...PROVIDERS]} />
          <TextField
            label="API key"
            name="apiKey"
            type="password"
            placeholder={savedKeys.includes(provider) ? 'Saved (enter a new key to replace it)' : 'sk-…'}
            help="Switching provider? Enter that provider's key; the other one stays saved."
          />
          <TextField
            label="Model"
            name="model"
            value={settings?.model}
            placeholder="Leave empty for the provider's default"
            help={
              <>
                Claude: {CLAUDE_MODELS.map((m, i) => [i > 0 && ', ', <Code>{m.value}</Code>])} (default{' '}
                <Code>{CLAUDE_MODELS[0]!.value}</Code>). OpenAI: any model your key can use (default{' '}
                <Code>{OPENAI_DEFAULT_MODEL}</Code>). Checked when you save.
              </>
            }
          />
          <TextField
            label="Brand voice"
            name="brandVoice"
            multiline
            value={settings?.brandVoice}
            placeholder="e.g. Friendly and down to earth, short sentences, no exclamation marks. We say “pieces”, not “products”."
            help="Optional. Applied to everything written for this shop."
          />
          <div>
            <Button>Save</Button>
          </div>
        </Form>
      </Card>

      {settings && (
        <Card title="Turn off" description="Removes the Generate buttons. Saved keys are deleted.">
          <Text tone="subdued">Staff keep everything already saved on products.</Text>
          <div>
            <Button variant="critical" action="/api/disconnect" reload>
              Turn off and delete keys
            </Button>
          </div>
        </Card>
      )}
    </Page>
  )
}

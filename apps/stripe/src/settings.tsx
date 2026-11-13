// The settings page, embedded in the ShopNex admin
import { Badge, Banner, Button, Card, Code, CopyableCode, Form, Page, Text, TextField } from '@shopnex/app/ui'

export type SettingsView = {
  connection: { accountId: string; accountName: string | null; livemode: boolean } | null
  ready: boolean
  canCreateWebhook: boolean
  webhookUrl: string
}

export function SettingsPage({ connection, ready, canCreateWebhook, webhookUrl }: SettingsView) {
  const account =
    connection && `${connection.accountName ?? connection.accountId}${connection.livemode ? '' : ' (test mode)'}`
  return (
    <Page
      title="Stripe"
      subtitle="Card payments, Apple Pay and Google Pay through Stripe Checkout."
      actions={
        <Badge tone={ready ? 'success' : 'warning'}>
          {ready ? 'Taking payments' : connection ? 'Almost there' : 'Not connected'}
        </Badge>
      }
    >
      {!connection ? (
        <Banner tone="warning" title="Not connected">
          Add your Stripe API key below.
        </Banner>
      ) : !ready ? (
        <Banner tone="warning" title="Almost there">
          Connected to {account}; add the webhook signing secret so orders are marked as paid.
        </Banner>
      ) : (
        <Banner tone="success" title="Taking payments">
          Connected to {account}. "Credit card" is offered at checkout.
        </Banner>
      )}

      <Card
        title={connection ? 'Change Stripe key' : 'Connect Stripe'}
        description={
          <>
            Create a restricted key in the Stripe Dashboard (Developers → API keys → Create restricted key) with write
            access to Checkout Sessions, Refunds and Webhook Endpoints, and read access to Account. A secret key works
            too, but a restricted key limits the damage if it leaks. A test-mode key (<Code>rk_test_…</Code>) lets you
            try checkout without real money. It's stored encrypted in your shop.
          </>
        }
      >
        <Form action="/api/settings" reload>
          <TextField
            label="Restricted or secret key"
            name="secretKey"
            type="password"
            placeholder={connection ? 'Saved (enter a new key to replace it)' : 'rk_test_…'}
          />
          {canCreateWebhook ? (
            <Text tone="subdued">Payment updates from Stripe are set up automatically.</Text>
          ) : (
            <TextField
              label="Webhook signing secret"
              name="webhookSecret"
              type="password"
              placeholder="whsec_…"
              help={
                <>
                  This app isn't on a public https URL, so Stripe can't reach it directly. Forward events with the
                  Stripe CLI and paste the signing secret it prints:
                  <CopyableCode value={`stripe listen --forward-to '${webhookUrl}'`} />
                </>
              }
            />
          )}
          <div>
            <Button>Save</Button>
          </div>
        </Form>
      </Card>
    </Page>
  )
}

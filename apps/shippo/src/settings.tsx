// The settings page, embedded in the ShopNex admin
import { Badge, Banner, Button, Card, Form, Page, Text, TextField } from '@shopnex/app/ui'
import type { Config } from './config'

export type SettingsView = {
  config: Config
  hasToken: boolean
  ready: boolean
  /** Set when ShopNex didn't take the carrier service */
  carrierError: string | null
  /** Switched off by staff in Settings → Shipping */
  carrierOff: boolean
}

export function SettingsPage({ config, hasToken, ready, carrierError, carrierOff }: SettingsView) {
  const o = config.origin
  const p = config.parcel
  return (
    <Page
      title="Shippo"
      subtitle="Live shipping rates from the carriers on your Shippo account, at checkout."
      actions={<Badge tone={ready ? 'success' : 'warning'}>{ready ? 'Quoting rates' : 'Not set up'}</Badge>}
    >
      {carrierError ? (
        <Banner tone="critical" title="ShopNex didn't accept the carrier service">
          {carrierError}
        </Banner>
      ) : carrierOff ? (
        <Banner tone="warning" title="Switched off">
          Shippo rates are switched off in Settings → Shipping.
        </Banner>
      ) : ready ? (
        <Banner tone="success" title="Quoting rates">
          Once the buyer has entered an address, checkout offers Shippo's rates.
        </Banner>
      ) : (
        <Banner tone="warning" title="Almost there">
          {hasToken ? 'Add the address you ship from below.' : 'Add your Shippo API token to get started.'}
        </Banner>
      )}

      <Card
        title={hasToken ? 'Change Shippo token' : 'Connect Shippo'}
        description="Create an API token in Shippo (Settings → API). A test token (shippo_test_…) quotes with test carriers. It is stored encrypted in your shop."
      >
        <Form action="/api/token" reload>
          <TextField
            label="API token"
            name="token"
            type="password"
            placeholder={hasToken ? 'Saved (enter a new token to replace it)' : 'shippo_test_…'}
          />
          <div>
            <Button>Save</Button>
          </div>
        </Form>
      </Card>

      <Card
        title="Ship-from address and parcel"
        description="Shippo prices a parcel from an address. ShopNex doesn't send product weights, so every item counts at the weight below and the cart is one parcel."
      >
        <Form action="/api/origin" reload>
          <TextField label="Name or company" name="name" value={o?.name} />
          <TextField label="Street address" name="street1" value={o?.street1} required />
          <TextField label="City" name="city" value={o?.city} required />
          <TextField label="State or province" name="state" value={o?.state} />
          <TextField label="Postal code" name="zip" value={o?.zip} required />
          <TextField label="Country (two-letter code)" name="country" value={o?.country} placeholder="US" required />
          <TextField label="Weight of one item (oz)" name="itemWeightOz" type="number" value={p.itemWeightOz} />
          <TextField label="Parcel length (in)" name="lengthIn" type="number" value={p.lengthIn} />
          <TextField label="Parcel width (in)" name="widthIn" type="number" value={p.widthIn} />
          <TextField label="Parcel height (in)" name="heightIn" type="number" value={p.heightIn} />
          <div>
            <Button>Save</Button>
          </div>
        </Form>
        <Text tone="subdued">Rates are in the shop's currency; a Shippo rate in another currency is left out.</Text>
      </Card>
    </Page>
  )
}

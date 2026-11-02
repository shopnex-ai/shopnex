// The settings page, embedded in the Shopnex admin: pick a processor, then configure it. Both screens are in the page
// (the session token in its URL lasts a minute, so moving between them in the browser beats reloading); the browser's
// Back button works between them.
import { Badge, Banner, Button, Card, Checkbox, CopyableCode, Form, Page, Text, TextField } from '@shopnex/app/ui'
import { raw } from 'hono/html'
import { ICONS } from './connectors.generated'
import { allFields, CONNECTORS, fieldLabel, fieldsOf, type ConnectorId } from './prism'

export const icon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#0d1b3e"/><path fill="#fff" d="M18 16h8v13h12V16h8v32h-8V36H26v12h-8z"/><circle cx="48" cy="18" r="5" fill="#3b82f6"/></svg>`

export type SettingsView = {
  connection: { connector: ConnectorId; testMode: boolean } | null
  saved: string[]
  ready: boolean
  webhookUrl: string
}

const POPULAR = [
  'stripe',
  'adyen',
  'paypal',
  'checkout',
  'braintree',
  'worldpay',
  'authorizedotnet',
  'cybersource',
].filter((id) => id in CONNECTORS)

const css = `
.hs-muted{color:color-mix(in oklch,var(--fg) 60%,transparent)}
.hs-section{display:flex;flex-direction:column;gap:.5rem}
.hs-section h3{margin:0;font-size:.8rem;font-weight:600;letter-spacing:.02em;text-transform:uppercase;color:color-mix(in oklch,var(--fg) 60%,transparent)}
.hs-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(12rem,1fr));gap:.5rem}
.hs-card{display:flex;align-items:center;gap:.65rem;min-width:0;padding:.65rem;border:1px solid var(--border);border-radius:var(--radius);
background:none;color:var(--fg);font:inherit;text-align:left;cursor:pointer}
.hs-card:hover,.hs-card:focus-visible{border-color:var(--ring);background:var(--muted);outline:none}
.hs-card span{min-width:0}
.hs-card b{display:block;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.hs-card small{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:.72rem;color:color-mix(in oklch,var(--fg) 60%,transparent)}
.hs-tile{flex:none;display:grid;place-items:center;width:2.5rem;height:2.5rem;border-radius:.65rem;font-weight:700;font-size:1rem}
.hs-logo{background:#fff;box-shadow:inset 0 0 0 1px #0000001a}.hs-logo img{width:1.7rem;height:1.7rem;object-fit:contain}
.hs-head{display:flex;align-items:center;gap:.85rem;padding-bottom:1rem;border-bottom:1px solid var(--border)}
.hs-head .hs-tile{width:3rem;height:3rem}.hs-head .hs-logo img{width:2rem;height:2rem}
.hs-head strong{display:block;font-size:1.1rem}
.hs-head div{flex:1;min-width:0}
.hs-back{background:none;border:0;padding:0;color:inherit;font:inherit;cursor:pointer;text-decoration:underline;text-underline-offset:3px}
.hs-fields{display:flex;flex-direction:column;gap:1rem}
.hs-none{padding:1rem;text-align:center;color:color-mix(in oklch,var(--fg) 60%,transparent)}
`

// The same hue every time for a processor: its monogram tile
const hue = (id: string) => [...id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7)

/** The processor's logo (served by this app), else the first letter on a colour taken from its name */
export function ProcessorTile({ id }: { id: string }) {
  if (ICONS.includes(id)) {
    return (
      <span class="hs-tile hs-logo">
        <img src={`/icons/${id}.svg`} alt="" loading="lazy" width="28" height="28" />
      </span>
    )
  }
  const h = hue(id)
  return (
    <span class="hs-tile" style={`background:hsl(${h} 70% 55% / .16);color:hsl(${h} 60% 45%)`} aria-hidden="true">
      {CONNECTORS[id]!.label[0]}
    </span>
  )
}

const needs = (id: string) => {
  const required = fieldsOf(id).filter((f) => !f.optional)
  return required.length ? required.map((f) => fieldLabel(f.name)).join(' · ') : 'Credentials'
}

function ProcessorCard({ id }: { id: string }) {
  const { label } = CONNECTORS[id]!
  return (
    <button type="button" class="hs-card" data-id={id} data-name={`${label} ${id}`.toLowerCase()}>
      <ProcessorTile id={id} />
      <span>
        <b>{label}</b>
        <small>{needs(id)}</small>
      </span>
    </button>
  )
}

// Each processor's fields, for the script that shows the right inputs once one is picked
const fieldMap = Object.fromEntries(Object.keys(CONNECTORS).map((id) => [id, fieldsOf(id)]))
const script = (saved: string[], savedConnector: string | null, initial: 'pick' | 'config') => `
const fields = ${JSON.stringify(fieldMap)}
const saved = ${JSON.stringify(saved)}
const savedConnector = ${JSON.stringify(savedConnector)}
const $ = (s) => document.querySelector(s)
const input = $('input[name=connector]'), pick = $('#hs-pick'), config = $('#hs-config')

function step(name, push) {
  pick.hidden = name !== 'pick'
  config.hidden = name !== 'config'
  if (push) { history.pushState({ step: name }, ''); window.scrollTo(0, 0) }
}

// Shows this processor's heading and credential inputs
function configure(id) {
  input.value = id
  const card = $('.hs-card[data-id=' + id + ']')
  $('#hs-head-tile').innerHTML = card.querySelector('.hs-tile').outerHTML
  $('#hs-head-name').textContent = card.querySelector('b').textContent
  $('#hs-head-needs').textContent = card.querySelector('small').textContent
  const wanted = new Map((fields[id] || []).map((f, i) => [f.name, { ...f, i }]))
  for (const box of document.querySelectorAll('[data-field]')) {
    const f = wanted.get(box.dataset.field)
    box.hidden = !f
    box.style.order = f ? f.i : 0
    const label = box.querySelector('label')
    if (label && f) label.textContent = box.dataset.label + (f.optional ? ' (optional)' : '')
    const el = box.querySelector('input')
    el.disabled = !f
    el.placeholder = id === savedConnector && saved.includes(box.dataset.field) ? 'Saved (enter a new value to replace it)' : ''
  }
}

for (const card of document.querySelectorAll('.hs-card')) {
  card.addEventListener('click', () => { configure(card.dataset.id); step('config', true) })
}
for (const back of document.querySelectorAll('[data-back]')) back.addEventListener('click', () => step('pick', true))
window.addEventListener('popstate', (e) => step((e.state && e.state.step) || ${JSON.stringify(initial)}))

$('.hs-search').addEventListener('input', (e) => {
  const q = e.target.value.trim().toLowerCase()
  let shown = 0
  for (const card of document.querySelectorAll('#hs-all .hs-card')) {
    const on = !q || card.dataset.name.includes(q)
    card.hidden = !on
    if (on) shown++
  }
  $('#hs-popular').hidden = !!q
  $('#hs-all h3').textContent = q ? 'Results' : 'All processors'
  $('.hs-none').hidden = shown > 0
})

configure(input.value)
history.replaceState({ step: ${JSON.stringify(initial)} }, '')`

export function SettingsPage({ connection, saved, ready, webhookUrl }: SettingsView) {
  const current = connection?.connector ?? 'stripe'
  const name = connection && (CONNECTORS[connection.connector]?.label ?? connection.connector)
  const initial = connection ? 'config' : 'pick'
  const wanted = new Set(fieldsOf(current).map((f) => f.name))
  return (
    <Page
      title="Hyperswitch"
      subtitle="Card payments through Hyperswitch Prism: one integration for Stripe, Adyen and more."
      actions={
        <Badge tone={ready ? 'success' : 'warning'}>
          {ready ? 'Taking payments' : connection ? 'Almost there' : 'Not connected'}
        </Badge>
      }
    >
      {!connection ? (
        <Banner tone="warning" title="Not connected">
          Choose your payment processor to get started.
        </Banner>
      ) : !ready ? (
        <Banner tone="warning" title="Almost there">
          Connected to {name}
          {connection.testMode ? ' (test mode)' : ''}; add the webhook signing secret so 3D Secure and delayed payments
          mark orders as paid.
        </Banner>
      ) : (
        <Banner tone="success" title="Taking payments">
          Connected to {name}
          {connection.testMode ? ' (test mode)' : ''}. "Credit card" is offered at checkout.
        </Banner>
      )}

      {/* Step 1: choose */}
      <div id="hs-pick" hidden={initial !== 'pick'}>
        <Card
          title="Choose a payment processor"
          description={`Hyperswitch Prism connects to ${Object.keys(CONNECTORS).length} processors through one integration. Pick the one your business already uses.`}
        >
          <input type="search" class="sx-input hs-search" placeholder="Search processors…" autocomplete="off" />
          <div class="hs-section" id="hs-popular">
            <h3>Popular</h3>
            <div class="hs-grid">
              {POPULAR.map((id) => (
                <ProcessorCard id={id} />
              ))}
            </div>
          </div>
          <div class="hs-section" id="hs-all">
            <h3>All processors</h3>
            <div class="hs-grid">
              {Object.keys(CONNECTORS).map((id) => (
                <ProcessorCard id={id} />
              ))}
            </div>
            <p class="hs-none" hidden>
              No processor matches.
            </p>
          </div>
        </Card>
      </div>

      {/* Step 2: configure */}
      <div id="hs-config" hidden={initial !== 'config'}>
        <Card>
          <Form action="/api/settings" reload>
            <div class="hs-head">
              <span id="hs-head-tile">
                <ProcessorTile id={current} />
              </span>
              <div>
                <strong id="hs-head-name">{CONNECTORS[current]?.label ?? current}</strong>
                <Text tone="subdued">
                  Needs: <span id="hs-head-needs">{needs(current)}</span>
                </Text>
              </div>
              <button type="button" class="hs-back" data-back>
                Change processor
              </button>
            </div>
            <input type="hidden" name="connector" value={current} />
            <p class="hs-muted" style="margin:0;font-size:.85rem">
              Credentials are stored encrypted in your shop. Buyers enter their card on a page hosted by this app, and
              the card is sent straight to your processor; it is never stored or logged.
            </p>
            <div class="hs-fields">
              {allFields.map((field) => (
                <div data-field={field} data-label={fieldLabel(field)} hidden={!wanted.has(field)}>
                  <TextField
                    label={fieldLabel(field)}
                    name={`field_${field}`}
                    type="password"
                    placeholder={connection && saved.includes(field) ? 'Saved (enter a new value to replace it)' : ''}
                  />
                </div>
              ))}
            </div>
            <TextField
              label="Webhook signing secret"
              name="webhookSecret"
              type="password"
              placeholder={connection ? 'Saved (enter a new secret to replace it)' : 'whsec_…'}
              help={
                <>
                  Add this URL as a webhook endpoint in your processor's dashboard, then paste the signing secret it
                  shows:
                  <CopyableCode value={webhookUrl} />
                </>
              }
            />
            <Checkbox
              label="Test mode"
              name="testMode"
              checked={connection?.testMode ?? true}
              help="Sends payments to the processor's sandbox."
            />
            <div>
              <Button>Save</Button>
            </div>
          </Form>
        </Card>
      </div>
      <style>{raw(css)}</style>
      <script>{raw(script(saved, connection?.connector ?? null, initial))}</script>
    </Page>
  )
}

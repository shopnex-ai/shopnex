// The settings page, embedded in the Shopnex admin
import { raw } from 'hono/html'
import {
  Badge,
  Banner,
  Button,
  Card,
  Checkbox,
  Code,
  Form,
  Inline,
  Page,
  Stack,
  Text,
  TextField,
} from '@shopnex/app/ui'
import type { CjSettings } from './cj'
import type { ForwardedOrder } from './db'

export const icon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#ff6a00"/><text x="32" y="42" text-anchor="middle" font-family="Arial,sans-serif" font-weight="700" font-size="28" fill="#fff">CJ</text></svg>`

export type MyProduct = {
  pid: string
  name: string
  sku: string | null
  image: string | null
  /** CJ's price, in USD */
  price: string | null
  /** false: CJ no longer sells it; null: not checked yet */
  available: boolean | null
  /** Its SKUs are already in the shop's catalog */
  inShop: boolean
  /** The app can match its orders to CJ variants */
  linked: boolean
}

export type SettingsView = {
  connected: boolean
  settings: CjSettings
  /** Why CJ's shipping prices aren't offered at checkout (null: they are) */
  shippingError: string | null
  orders: ForwardedOrder[]
}

// Product cards, on the admin look the kit's Page provides (its CSS variables)
const styles = `
.cj-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(11rem,1fr));gap:1rem}
.cj-card{display:flex;flex-direction:column;border:1px solid var(--border);border-radius:var(--radius);overflow:hidden;background:var(--bg,transparent)}
.cj-card form{display:contents}
.cj-card .sx-stack{gap:0;flex:1}
.cj-card .sx-error{padding:0 .75rem .75rem;margin:0}
.cj-img{aspect-ratio:1;background:var(--muted);display:block;width:100%;object-fit:cover}
.cj-img.cj-off{opacity:.35;filter:grayscale(1)}
.cj-body{display:flex;flex-direction:column;gap:.35rem;padding:.75rem;flex:1}
.cj-name{font-size:.875rem;line-height:1.3;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;margin:0}
.cj-meta{display:flex;flex-direction:column;gap:.25rem;margin-top:auto;align-items:flex-start}
.cj-meta .sx-code{font-size:.7rem;word-break:normal;white-space:nowrap}
.cj-price{font-weight:600}
.cj-action{padding:0 .75rem .75rem}
.cj-action .sx-btn,.cj-action .sx-badge{width:100%;justify-content:center;text-align:center}
.cj-skel{aspect-ratio:3/4;border-radius:var(--radius);background:var(--muted);animation:cj-pulse 1.5s ease-in-out infinite}
@keyframes cj-pulse{50%{opacity:.5}}
`

// CJ sends "11.63" or a range of its variants, "4.70-14.73"
const money = (price: string) =>
  price
    .split('-')
    .map((part) => `$${part.trim()}`)
    .join(' – ')

// Importing takes a few seconds: say so on the button, and swap the card to "In your shop" when it is done,
// instead of reloading the page (which jumps back to the top)
const script = `
const WORDS = { '/api/import': 'Importing…', '/api/link': 'Linking…' }
document.addEventListener('submit', (event) => {
  const form = event.target.closest('.cj-card form')
  const button = form?.querySelector('button')
  if (!button) return
  const label = button.textContent
  button.textContent = WORDS[form.dataset.shopnexAction] ?? label
  // The client re-enables the button when the request ends: put the label back (an error leaves the card as it was)
  new MutationObserver((_, observer) => {
    if (button.disabled) return
    button.textContent = label
    observer.disconnect()
  }).observe(button, { attributes: true, attributeFilter: ['disabled'] })
})
document.addEventListener('shopnex:done', (event) => {
  const action = event.target.closest?.('.cj-card')?.querySelector('.cj-action')
  if (action) action.innerHTML = '<span class="sx-badge sx-success">In your shop</span>'
})
`

// My Products comes from CJ, which allows one call a second, so the page opens first and the list is filled in
// from /api/products (an HTML fragment) once the admin's session is ready
const loadProducts = `
const box = document.getElementById('cj-products')
async function load() {
  while (!window.shopnex) await new Promise((resolve) => setTimeout(resolve, 50))
  try {
    const res = await window.shopnex.authenticatedFetch('/api/products')
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'Could not load My Products')
    box.innerHTML = await res.text()
  } catch (error) {
    box.innerHTML = ''
    const p = document.createElement('p')
    p.className = 'sx-error'
    p.textContent = error?.message ?? String(error)
    box.append(p)
  }
}
if (box) load()
`

/** The My Products cards, rendered on their own for /api/products */
export function ProductList({ products, productsError }: { products: MyProduct[]; productsError: string | null }) {
  return (
    <>
      {productsError && <Banner tone="critical">{productsError}</Banner>}
      <Stack gap={3}>
        <div class="cj-grid">
          {products.map((p) => {
            const off = p.available === false
            const details = (
              <>
                {p.image ? (
                  <img
                    class={`cj-img${off ? ' cj-off' : ''}`}
                    src={p.image}
                    alt=""
                    loading="lazy"
                    referrerpolicy="no-referrer"
                  />
                ) : (
                  <div class="cj-img" />
                )}
                <div class="cj-body">
                  <p class="cj-name" title={p.name}>
                    {p.name}
                  </p>
                  <div class="cj-meta">
                    {p.price && <span class="cj-price">{money(p.price)}</span>}
                    {p.sku && <Code>{p.sku}</Code>}
                  </div>
                </div>
              </>
            )
            const card = (action: unknown) => (
              <div class="cj-card">
                {details}
                <div class="cj-action">{action}</div>
              </div>
            )
            // CJ took it off sale: nothing to import
            if (off) return card(<Badge tone="warning">Off sale</Badge>)
            // Already in the catalog: don't import it twice. Once linked, its orders go to CJ.
            if (p.inShop && p.linked) return card(<Badge tone="success">In your shop</Badge>)
            if (p.inShop) {
              return (
                <div class="cj-card">
                  <Form action="/api/link" success="Linked to CJ">
                    <input type="hidden" name="pid" value={p.pid} />
                    {details}
                    <div class="cj-action">
                      <Button variant="secondary">Link to CJ</Button>
                    </div>
                  </Form>
                </div>
              )
            }
            return (
              <div class="cj-card">
                <Form action="/api/import" success="Imported as a draft">
                  <input type="hidden" name="pid" value={p.pid} />
                  {details}
                  <div class="cj-action">
                    <Button variant="secondary">Import</Button>
                  </div>
                </Form>
              </div>
            )
          })}
        </div>
        {!productsError && products.length === 0 && <Text tone="subdued">Nothing in My Products yet.</Text>}
      </Stack>
    </>
  )
}

const STATUS_TONE = { pending: 'warning', created: 'default', fulfilled: 'success', failed: 'critical' } as const

export function SettingsPage({ connected, settings, shippingError, orders }: SettingsView) {
  return (
    <Page
      title="CJ Dropshipping"
      subtitle="Import CJ products and send paid orders to CJ."
      actions={<Badge tone={connected ? 'success' : 'warning'}>{connected ? 'Connected' : 'Not connected'}</Badge>}
    >
      <style>{raw(styles)}</style>
      <script type="module">{raw(script)}</script>
      {connected && <script type="module">{raw(loadProducts)}</script>}
      {!connected && (
        <Banner tone="warning" title="Not connected">
          Add your CJ API key below.
        </Banner>
      )}

      <Card
        title={connected ? 'Change API key' : 'Connect CJ'}
        description={
          <>
            In CJ, open Authorization → API → Generate API key, and paste it here. It's stored encrypted in your shop.
          </>
        }
      >
        <Form action="/api/connect" reload>
          <TextField
            label="CJ API key"
            name="apiKey"
            type="password"
            placeholder={connected ? 'Saved (enter a new key to replace it)' : 'CJ…@api@…'}
          />
          <div>
            <Button>{connected ? 'Update key' : 'Connect'}</Button>
          </div>
        </Form>
      </Card>

      {connected && (
        <>
          <Card title="Pricing and orders">
            <Form action="/api/settings" success="Saved">
              <TextField
                label="Markup (%)"
                name="markupPercent"
                value={String(settings.markupPercent)}
                help="Added to CJ's price when you import a product. 100 doubles it."
              />
              <Checkbox
                label="Pay CJ orders automatically"
                name="autoPay"
                checked={settings.autoPay}
                help="Uses your CJ balance as soon as an order is sent. Off: orders wait in CJ until you pay them."
              />
              <div>
                <Button>Save</Button>
              </div>
            </Form>
          </Card>

          <Card title="Shipping at checkout">
            {shippingError ? (
              <Banner tone="warning" title="Not on yet">
                {shippingError.replace(/[.\s]*$/, '.')} Uninstall the app and install it again to allow shipping prices.
              </Banner>
            ) : (
              <Banner tone="success" title="On">
                Buyers see CJ&apos;s shipping price as &quot;Standard shipping&quot; once they enter an address.
              </Banner>
            )}
            <Text tone="subdued">
              This works for carts made only of CJ products, in a shop that sells in USD, to countries CJ ships to.
              Otherwise buyers get your own shipping rates, and if you have none, checkout says it can&apos;t ship to
              that address.
            </Text>
          </Card>

          <Card
            title="Import from My Products"
            description="Products you added to My Products in CJ. They arrive as drafts, so you can review them before they go live."
          >
            <div id="cj-products">
              <div class="cj-grid">
                {[0, 1, 2, 3].map(() => (
                  <div class="cj-skel" />
                ))}
              </div>
            </div>
            <Form action="/api/import" success="Imported as a draft">
              <TextField label="Or a CJ product ID" name="pid" placeholder="1444929719182168064" />
              <div>
                <Button variant="secondary">Import</Button>
              </div>
            </Form>
          </Card>

          <Card title="Orders sent to CJ">
            <Stack gap={3}>
              {orders.map((o) => (
                <Inline>
                  <Text>
                    #{o.orderNumber}
                    {o.cjOrderId && (
                      <>
                        {' '}
                        · CJ <Code>{o.cjOrderId}</Code>
                      </>
                    )}
                    {o.trackingNumber && (
                      <>
                        {' '}
                        · <Code>{o.trackingNumber}</Code>
                      </>
                    )}
                  </Text>
                  <Badge tone={STATUS_TONE[o.status]}>{o.status}</Badge>
                  {o.error && <Text tone="subdued">{o.error}</Text>}
                  {o.status === 'failed' && (
                    <Form action={`/api/orders/${o.orderId}/retry`} reload>
                      <Button variant="secondary">Retry</Button>
                    </Form>
                  )}
                </Inline>
              ))}
              {orders.length === 0 && <Text tone="subdued">Paid orders with CJ products show up here.</Text>}
            </Stack>
          </Card>
        </>
      )}
    </Page>
  )
}

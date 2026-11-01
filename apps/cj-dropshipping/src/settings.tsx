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
  Select,
  Stack,
  Text,
  TextField,
} from '@shopnex/app/ui'
import type { CategoryAttribute, CategoryCertification, CjShop, PlatformBrand, PlatformCategory } from '@shopnex/cj-sdk'
import type { CjSettings } from './cj'
import type { ForwardedOrder, Listing } from './db'
import { attributeField, missingCertifications, STORE_OK } from './tiktok'

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
.tt-cats{display:flex;flex-wrap:wrap;gap:.5rem}
.tt-step{margin-top:1rem}
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

// The TikTok card is a few steps, each an HTML fragment from the app: the panel (store and product), then the
// category (one level at a time), then the form. A button with data-tt-load fetches its fragment into the step box;
// the first one reads the store and product from the panel's selects.
const tiktok = `
const panel = document.getElementById('cj-tiktok')
async function ready() {
  while (!window.shopnex) await new Promise((resolve) => setTimeout(resolve, 50))
}
function showError(box, error) {
  const p = document.createElement('p')
  p.className = 'sx-error'
  p.textContent = error?.message ?? String(error)
  box.replaceChildren(p)
}
async function fetchInto(box, url) {
  await ready()
  box.innerHTML = '<div class="cj-skel" style="aspect-ratio:auto;height:4rem"></div>'
  try {
    const res = await window.shopnex.authenticatedFetch(url)
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'Could not load this step')
    box.innerHTML = await res.text()
  } catch (error) {
    showError(box, error)
  }
}
if (panel) fetchInto(panel, '/api/tiktok')
document.addEventListener('click', (event) => {
  const button = event.target.closest('[data-tt-load]')
  if (!button) return
  event.preventDefault()
  const step = document.getElementById('tt-step')
  let url = button.dataset.ttLoad
  if (button.hasAttribute('data-tt-start')) {
    const shop = panel.querySelector('select[name=shop]')?.value
    const pid = panel.querySelector('select[name=pid]')?.value
    if (!shop || !pid) return showError(step, new Error('Choose a store and a product'))
    url += '&shop=' + encodeURIComponent(shop) + '&pid=' + encodeURIComponent(pid)
  }
  if (step) fetchInto(step, url)
})
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

const LISTING_TONE = {
  PRODUCT_STAY: 'warning',
  PRODUCT_CENTRE: 'warning',
  PRODUCT_SUCCESS: 'success',
  PRODUCT_FAIL: 'critical',
  PRODUCT_CANCEL: 'default',
} as const
const LISTING_LABEL = {
  PRODUCT_STAY: 'Waiting',
  PRODUCT_CENTRE: 'Listing',
  PRODUCT_SUCCESS: 'Listed',
  PRODUCT_FAIL: 'Failed',
  PRODUCT_CANCEL: 'Cancelled',
} as const

export type TikTokPanelView = {
  stores: CjShop[]
  storesError: string | null
  products: { pid: string; name: string }[]
  productsError: string | null
  listings: Listing[]
}

/** The first step of listing on TikTok: which store and product, and what was listed before */
export function TikTokPanel({ stores, storesError, products, productsError, listings }: TikTokPanelView) {
  const usable = stores.filter((s) => s.status === STORE_OK)
  const lapsed = stores.filter((s) => s.status !== STORE_OK)
  return (
    <Stack gap={3}>
      {storesError && <Banner tone="critical">{storesError}</Banner>}
      {!storesError && stores.length === 0 && (
        <Banner tone="warning" title="No TikTok store linked">
          Authorize your TikTok Shop store in your CJ account, then reload this page. CJ keeps the TikTok connection and
          fulfills the orders.
        </Banner>
      )}
      {lapsed.map((s) => (
        <Banner tone="warning" title={`${s.aliasName || s.name} needs to be authorized again`}>
          CJ can&apos;t use this TikTok store right now. Authorize it again in CJ.
        </Banner>
      ))}
      {productsError && <Banner tone="critical">{productsError}</Banner>}
      {usable.length > 0 && (
        <>
          <Select
            label="TikTok store"
            name="shop"
            options={usable.map((s) => ({ value: s.id, label: `${s.aliasName || s.name} (${s.type})` }))}
          />
          <Select
            label="CJ product"
            name="pid"
            help="From My Products in CJ."
            options={products.map((p) => ({ value: p.pid, label: p.name }))}
          />
          <div>
            <button
              type="button"
              class="sx-btn sx-btn-primary"
              data-tt-start
              data-tt-load="/api/tiktok/categories?parent=0"
            >
              Choose category
            </button>
          </div>
        </>
      )}
      <div id="tt-step" class="tt-step" />
      {listings.length > 0 && (
        <Stack gap={3}>
          <Text tone="subdued">Sent to TikTok</Text>
          {listings.map((l) => (
            <Inline>
              <Text>
                {l.title} · {l.cjShopName}
              </Text>
              <Badge tone={LISTING_TONE[l.status]}>{LISTING_LABEL[l.status]}</Badge>
              {l.url && (
                <a href={l.url} target="_blank" rel="noreferrer">
                  View
                </a>
              )}
              {l.error && <Text tone="subdued">{l.error}</Text>}
            </Inline>
          ))}
        </Stack>
      )}
    </Stack>
  )
}

const qs = (params: Record<string, string>) =>
  Object.entries(params)
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join('&')

/**
 * One level of TikTok's category tree. `path` is the ids walked so far (starting with 0) and `names` the names of
 * the ones after it, so a step back needs no call of its own.
 */
export function CategoryStep({
  shop,
  pid,
  path,
  names,
  categories,
}: {
  shop: string
  pid: string
  path: string[]
  names: string[]
  categories: PlatformCategory[]
}) {
  const base = { shop, pid }
  const sorted = [...categories].sort((a, b) => Number(b.defaultMatching ?? false) - Number(a.defaultMatching ?? false))
  return (
    <Stack gap={3}>
      <Text tone="subdued">{names.length > 0 ? names.join(' › ') : 'Choose the TikTok category for this product'}</Text>
      <div class="tt-cats">
        {path.length > 1 && (
          <button
            type="button"
            class="sx-btn sx-btn-plain"
            data-tt-load={`/api/tiktok/categories?${qs({ ...base, parent: path[path.length - 2]!, path: path.slice(0, -1).join(','), names: names.slice(0, -1).join('|') })}`}
          >
            ← Back
          </button>
        )}
        {sorted.map((c) => (
          <button
            type="button"
            class="sx-btn sx-btn-secondary"
            data-tt-load={
              c.leafCategory
                ? `/api/tiktok/form?${qs({ ...base, category: c.categoryId, name: [...names, c.categoryName].join(' › ') })}`
                : `/api/tiktok/categories?${qs({ ...base, parent: c.categoryId, path: [...path, c.categoryId].join(','), names: [...names, c.categoryName].join('|') })}`
            }
          >
            {c.categoryName}
            {c.defaultMatching ? ' ★' : ''}
          </button>
        ))}
      </div>
      {categories.length === 0 && <Text tone="subdued">TikTok has no categories here.</Text>}
    </Stack>
  )
}

/** The last step: brand, price and the attributes the category requires */
export function ListingForm({
  shop,
  pid,
  categoryId,
  categoryName,
  title,
  markupPercent,
  attributes,
  brands,
  certifications,
}: {
  shop: string
  pid: string
  categoryId: string
  categoryName: string
  title: string
  markupPercent: number
  attributes: CategoryAttribute[]
  brands: PlatformBrand[]
  certifications: CategoryCertification[]
}) {
  const missing = missingCertifications(certifications)
  return (
    <Form action="/api/tiktok/list" reload success="Sent to TikTok through CJ">
      <input type="hidden" name="shopId" value={shop} />
      <input type="hidden" name="pid" value={pid} />
      <input type="hidden" name="categoryId" value={categoryId} />
      <Text>
        {title} · {categoryName}
      </Text>
      {missing.length > 0 && (
        <Banner tone="warning" title="Certificates TikTok asks for">
          {missing.map((c) => c.name).join(', ')}: CJ doesn&apos;t have these on file, so TikTok may refuse the listing.
          Add them in CJ first.
        </Banner>
      )}
      <Select
        label="Brand"
        name="brandId"
        options={[
          { value: '', label: 'No brand' },
          ...brands.filter((b) => b.brandName !== 'No brand').map((b) => ({ value: b.brandId, label: b.brandName })),
        ]}
      />
      {attributes.map((a) =>
        a.values?.length ? (
          <Select
            label={a.label || a.name}
            name={attributeField(a.id)}
            required
            options={[{ value: '', label: 'Choose…' }, ...a.values.map((v) => ({ value: v.id, label: v.value }))]}
          />
        ) : (
          <TextField label={a.label || a.name} name={attributeField(a.id)} required />
        ),
      )}
      <TextField
        label="Markup (%)"
        name="markupPercent"
        value={String(markupPercent)}
        help="Added to CJ's price for the TikTok price. It doesn't include shipping."
      />
      <div>
        <Button>List on TikTok</Button>
      </div>
    </Form>
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
      {connected && <script type="module">{raw(tiktok)}</script>}
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

          <Card
            title="List on TikTok Shop"
            description="Send a CJ product to your TikTok Shop store. CJ keeps the TikTok connection and fulfills the orders."
          >
            <div id="cj-tiktok">
              <div class="cj-skel" style="aspect-ratio:auto;height:4rem" />
            </div>
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

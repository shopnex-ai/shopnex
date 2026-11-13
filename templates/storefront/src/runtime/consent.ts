// /shopnex/consent.js, loaded by `{{ content_for_header }}` on every storefront page, for every theme.
//
// Holds back what needs a visitor's consent until they give it. A merchant marks such a script (or embed) once:
//
//   <script type="text/plain" data-consent="analytics" src="https://example.com/tag.js"></script>
//   <iframe data-consent="marketing" data-src="https://example.com/video"></iframe>
//
// `data-consent` is `analytics`, `marketing`, or both separated by a comma (then both are needed). The browser ignores
// a `text/plain` script, so it does nothing until this file turns it into a real one.
//
// The shop's setting (<meta name="shopnex-consent" content="banner|off">) decides whether anyone is asked:
//   banner  a banner asks until the visitor chooses (Accept all / Reject all); the answer is remembered in
//           localStorage, so no cookie is set to remember a "no"
//   off     nobody is asked and those scripts run at once (the shop handles consent another way, or needs none)
//
// Themes and custom code can read and change the choice through window.shopnexConsent, and link to it with
// <a href="#" data-shopnex-consent-settings>Cookie settings</a>. Built by scripts/themes.mjs into built/consent.js and
// served by src/pages/shopnex/consent.js.ts.

export type Consent = { analytics: boolean; marketing: boolean }
type Listener = (consent: Consent) => void

const KEY = 'shopnex_consent'
const NOTHING: Consent = { analytics: false, marketing: false }
const EVERYTHING: Consent = { analytics: true, marketing: true }

const asks = document.querySelector<HTMLMetaElement>('meta[name="shopnex-consent"]')?.content === 'banner'
const listeners = new Set<Listener>()

/** What the visitor chose, or null if they have not (or storage is blocked: then they are asked every time) */
function saved(): Consent | null {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<Consent> | null
    return raw && typeof raw.analytics === 'boolean' && typeof raw.marketing === 'boolean'
      ? { analytics: raw.analytics, marketing: raw.marketing }
      : null
  } catch {
    return null
  }
}

/** What may run now: everything when nobody is asked, otherwise only what was agreed to */
const current = (): Consent => (asks ? (saved() ?? NOTHING) : EVERYTHING)

const needs = (el: Element) =>
  (el.getAttribute('data-consent') ?? '')
    .split(',')
    .map((c) => c.trim())
    .filter((c): c is keyof Consent => c === 'analytics' || c === 'marketing')

/** Turns the held-back scripts and embeds whose categories are all allowed into real ones */
function activate() {
  const allowed = current()
  const ready = (el: Element) => {
    const categories = needs(el)
    return categories.length > 0 && categories.every((c) => allowed[c])
  }
  for (const held of document.querySelectorAll<HTMLScriptElement>('script[type="text/plain"][data-consent]')) {
    if (!ready(held)) continue
    const script = document.createElement('script')
    for (const { name, value } of held.attributes) {
      if (name !== 'type' && name !== 'data-consent') script.setAttribute(name, value)
    }
    script.text = held.text
    held.replaceWith(script)
  }
  for (const held of document.querySelectorAll<HTMLIFrameElement>('iframe[data-consent][data-src]')) {
    if (ready(held)) held.src = held.getAttribute('data-src')!
  }
}

function save(next: Consent) {
  const before = current()
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...next, at: new Date().toISOString() }))
  } catch {
    // Storage is blocked: the choice holds for this page only
  }
  hideBanner()
  // A script that already ran cannot be taken back: leaving it out is only possible on the next page load
  const withdrew = (['analytics', 'marketing'] as const).some((c) => before[c] && !next[c])
  if (withdrew) return location.reload()
  activate()
  for (const listener of listeners) listener(next)
  document.dispatchEvent(new CustomEvent('shopnex:consent', { detail: next }))
}

// ── the banner ────────────────────────────────────────────────────────────────

const ID = 'shopnex-consent-banner'
const STYLE = `
#${ID}{position:fixed;left:12px;right:12px;bottom:12px;z-index:2147483000;max-width:560px;margin:0 auto;padding:16px;
background:#fff;color:#111827;border:1px solid #d1d5db;border-radius:10px;box-shadow:0 10px 30px rgba(0,0,0,.18);
font:14px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif}
#${ID} p{margin:0 0 12px}
#${ID} .sc-buttons{display:flex;flex-wrap:wrap;gap:8px}
#${ID} button{flex:1 1 140px;padding:10px 14px;border-radius:8px;border:1px solid #111827;background:#fff;color:#111827;
font:inherit;font-weight:600;cursor:pointer}
#${ID} button:focus-visible{outline:2px solid #2563eb;outline-offset:2px}
`

function showBanner() {
  if (document.getElementById(ID)) return
  const style = document.createElement('style')
  style.id = `${ID}-style`
  style.textContent = STYLE
  const banner = document.createElement('div')
  banner.id = ID
  banner.setAttribute('role', 'dialog')
  banner.setAttribute('aria-label', 'Cookie settings')
  const text = document.createElement('p')
  text.textContent =
    'We would like to use cookies and similar tools to measure how this store is used and to show relevant ads. ' +
    'You can accept or reject them; the store works either way.'
  const buttons = document.createElement('div')
  buttons.className = 'sc-buttons'
  // Rejecting is as easy as accepting: same size and weight, side by side
  const reject = document.createElement('button')
  reject.type = 'button'
  reject.textContent = 'Reject all'
  reject.addEventListener('click', () => save(NOTHING))
  const accept = document.createElement('button')
  accept.type = 'button'
  accept.textContent = 'Accept all'
  accept.addEventListener('click', () => save(EVERYTHING))
  buttons.append(reject, accept)
  banner.append(text, buttons)
  document.head.append(style)
  document.body.append(banner)
}

function hideBanner() {
  document.getElementById(ID)?.remove()
  document.getElementById(`${ID}-style`)?.remove()
}

// ── the API ───────────────────────────────────────────────────────────────────

export const shopnexConsent = {
  /** True when this shop asks visitors; false when it does not (everything is allowed) */
  asks,
  /** What is allowed now */
  get: current,
  /** null until the visitor has chosen (always null when nobody is asked) */
  choice: saved,
  set: (consent: Consent) => save(consent),
  accept: () => save(EVERYTHING),
  reject: () => save(NOTHING),
  /** Shows the banner again, to change the choice */
  open: () => {
    if (asks) showBanner()
  },
  /** Called with the new choice every time it is saved. Returns a function that stops listening. */
  onChange: (listener: Listener) => {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },
}

declare global {
  interface Window {
    shopnexConsent: typeof shopnexConsent
  }
}
window.shopnexConsent = shopnexConsent

document.addEventListener('click', (event) => {
  const link = (event.target as Element | null)?.closest('[data-shopnex-consent-settings]')
  if (!link) return
  event.preventDefault()
  shopnexConsent.open()
})

function start() {
  activate()
  if (asks && saved() === null) showBanner()
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start)
else start()

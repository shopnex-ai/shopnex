// The hosted card page the buyer lands on from Shopnex. It posts the card to this app, which hands it to the
// processor through Prism; nothing about the card is stored or logged.
import { raw } from 'hono/html'

const css = `
:root{color-scheme:light dark;--bg:#f5f6f8;--card:#fff;--fg:#14171f;--muted:#667085;--line:#d9dde3;--accent:#0d1b3e;--accent-fg:#fff;--bad:#b42318;--bad-bg:#fef3f2;--ring:#2e6bff}
@media(prefers-color-scheme:dark){:root{--bg:#0e1116;--card:#171b22;--fg:#eef0f4;--muted:#9aa3b2;--line:#2b313b;--accent:#e8ecf5;--accent-fg:#0e1116;--bad:#ffb4ab;--bad-bg:#3a1c19;--ring:#7aa2ff}}
*{box-sizing:border-box}
body{margin:0;font:16px/1.45 system-ui,-apple-system,sans-serif;background:var(--bg);color:var(--fg);min-height:100vh;display:grid;place-items:center;padding:16px}
main{background:var(--card);border-radius:16px;box-shadow:0 1px 3px #0000001a,0 12px 32px #0000000f;padding:28px;width:100%;max-width:440px}
.top{display:flex;justify-content:space-between;align-items:baseline;gap:12px;padding-bottom:18px;margin-bottom:20px;border-bottom:1px solid var(--line)}
.top span{color:var(--muted);font-size:14px}.top strong{font-size:26px;letter-spacing:-.02em}
label{display:block;font-size:13px;font-weight:600;margin:16px 0 6px}
.field{position:relative}
input{width:100%;padding:12px;border:1px solid var(--line);border-radius:10px;font:inherit;background:transparent;color:inherit}
input:focus{outline:none;border-color:var(--ring);box-shadow:0 0 0 3px color-mix(in srgb,var(--ring) 28%,transparent)}
.brand{position:absolute;right:10px;top:50%;transform:translateY(-50%);font-size:11px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:var(--muted);background:var(--bg);border-radius:6px;padding:3px 7px}
.brand:empty{display:none}
.row{display:flex;gap:12px}.row>div{flex:1}
button{margin-top:24px;width:100%;padding:14px;border:0;border-radius:10px;background:var(--accent);color:var(--accent-fg);font:inherit;font-weight:600;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:8px}
button:hover{opacity:.92}button:disabled{opacity:.6;cursor:wait}
button svg{width:16px;height:16px}
.error{background:var(--bad-bg);color:var(--bad);padding:12px;border-radius:10px;margin-bottom:4px;font-size:14px}
.note{display:flex;align-items:center;justify-content:center;gap:6px;margin:16px 0 0;color:var(--muted);font-size:12px}
.note svg{width:13px;height:13px}
`

const lock = (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <rect x="4" y="11" width="16" height="10" rx="2" />
    <path d="M8 11V7a4 4 0 0 1 8 0v4" />
  </svg>
)

// Spaces in the card number, the slash in the expiry, the card's brand; the form works without any of it
const enhance = String.raw`
const $ = (id) => document.getElementById(id)
const number = $('number'), expiry = $('expiry'), brand = $('brand'), form = $('pay')
const brands = [['Amex', /^3[47]/], ['Visa', /^4/], ['Mastercard', /^(5[1-5]|2[2-7])/], ['Discover', /^(6011|65|64[4-9])/], ['JCB', /^35/], ['Diners', /^(30[0-5]|36|38)/], ['UnionPay', /^62/]]
number.addEventListener('input', () => {
  const digits = number.value.replace(/\D/g, '').slice(0, 19)
  const amex = /^3[47]/.test(digits)
  number.value = (amex ? digits.replace(/^(\d{1,4})(\d{1,6})?(\d{1,5})?$/, (_, a, b, c) => [a, b, c].filter(Boolean).join(' ')) : digits.replace(/(\d{4})(?=\d)/g, '$1 '))
  brand.textContent = (brands.find(([, re]) => re.test(digits)) || [''])[0]
})
expiry.addEventListener('input', (e) => {
  let v = expiry.value.replace(/\D/g, '').slice(0, 4)
  if (v.length === 1 && Number(v) > 1) v = '0' + v
  if (e.inputType !== 'deleteContentBackward' && v.length >= 2) v = v.slice(0, 2) + '/' + v.slice(2)
  expiry.value = v
})
form.addEventListener('submit', () => { const b = form.querySelector('button'); b.disabled = true; b.lastChild.textContent = 'Processing…' })`

const Shell = ({ children }: { children: unknown }) => (
  <html lang="en">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width,initial-scale=1" />
      <meta name="robots" content="noindex" />
      <title>Pay</title>
      <style>{raw(css)}</style>
    </head>
    <body>
      <main>{children as never}</main>
    </body>
  </html>
)

export type CheckoutView = { token: string; orderNumber: number; amount: string; error?: string }

export function CheckoutPage({ token, orderNumber, amount, error }: CheckoutView) {
  return (
    <Shell>
      <div class="top">
        <span>Order #{orderNumber}</span>
        <strong>{amount}</strong>
      </div>
      {error && (
        <div class="error" role="alert">
          {error}
        </div>
      )}
      <form id="pay" method="post" action={`/pay/${token}`} autocomplete="on">
        <label for="name">Name on card</label>
        <input id="name" name="name" autocomplete="cc-name" required />
        <label for="number">Card number</label>
        <div class="field">
          <input
            id="number"
            name="number"
            inputmode="numeric"
            autocomplete="cc-number"
            maxlength={23}
            placeholder="1234 1234 1234 1234"
            required
          />
          <span class="brand" id="brand" aria-hidden="true"></span>
        </div>
        <div class="row">
          <div>
            <label for="expiry">Expiry</label>
            <input
              id="expiry"
              name="expiry"
              inputmode="numeric"
              autocomplete="cc-exp"
              placeholder="MM/YY"
              maxlength={7}
              required
            />
          </div>
          <div>
            <label for="cvc">CVC</label>
            <input
              id="cvc"
              name="cvc"
              inputmode="numeric"
              autocomplete="cc-csc"
              maxlength={4}
              placeholder="123"
              required
            />
          </div>
        </div>
        <button type="submit">
          {lock}
          <span>Pay {amount}</span>
        </button>
      </form>
      <p class="note">{lock} Your card details go straight to the payment processor and are never stored.</p>
      <script>{raw(enhance)}</script>
    </Shell>
  )
}

/** A connector's redirect (3D Secure…) as a form the browser submits itself */
export function RedirectForm({ endpoint, fields }: { endpoint: string; fields: Record<string, string> }) {
  return (
    <Shell>
      <p>Redirecting to your bank…</p>
      <form id="f" method="post" action={endpoint}>
        {Object.entries(fields).map(([name, value]) => (
          <input type="hidden" name={name} value={value} />
        ))}
        <button type="submit">Continue</button>
      </form>
      <script>{raw("document.getElementById('f').submit()")}</script>
    </Shell>
  )
}

export function MessagePage({ message }: { message: string }) {
  return (
    <Shell>
      <p>{message}</p>
    </Shell>
  )
}

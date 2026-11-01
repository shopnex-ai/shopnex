// The HTML of the customer account pages. Themes don't need templates for them: this is the page's content,
// shown inside the theme's layout (ThemePage 'account'). Markup is plain with a few classes and colors that
// follow the theme (currentColor, inherit), so it fits any theme without its CSS.
import { formatMoney } from '@shopnex/storefront-sdk/money'
import type { Customer, CustomerOrder } from '@shopnex/storefront-sdk'

export const esc = (value: string | number | null | undefined) =>
  String(value ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)

const STYLE = `<style>
.sx-account{max-width:48rem;margin:0 auto;padding:2.5rem 1rem;font:inherit;color:inherit}
.sx-account h1{font-size:1.75rem;margin:0 0 1rem}
.sx-account h2{font-size:1.15rem;margin:2rem 0 .75rem}
.sx-account p{margin:0 0 1rem}
.sx-account label{display:block;font-weight:600;margin:0 0 .35rem}
.sx-account input[type=email],.sx-account input[type=text],.sx-account input[type=tel]{display:block;width:100%;box-sizing:border-box;padding:.65rem .75rem;border:1px solid currentColor;border-radius:.375rem;background:transparent;color:inherit;font:inherit;margin:0 0 1rem}
.sx-account input.sx-code{font-size:1.5rem;letter-spacing:.4em;text-align:center}
.sx-account button{display:inline-block;padding:.65rem 1.25rem;border:1px solid currentColor;border-radius:.375rem;background:transparent;color:inherit;font:inherit;font-weight:600;cursor:pointer}
.sx-account button:hover{opacity:.7}
.sx-account button.sx-link{background:none;border:0;padding:0;font-weight:inherit;text-decoration:underline}
.sx-account .sx-error{padding:.75rem 1rem;border:1px solid #b91c1c;color:#b91c1c;border-radius:.375rem;margin:0 0 1rem}
.sx-account .sx-note{opacity:.7;font-size:.9rem}
.sx-account table{width:100%;border-collapse:collapse}
.sx-account th,.sx-account td{text-align:left;padding:.65rem .5rem;border-bottom:1px solid rgba(128,128,128,.35);vertical-align:top}
.sx-account td.sx-num,.sx-account th.sx-num{text-align:right;white-space:nowrap}
.sx-account .sx-row{display:flex;justify-content:space-between;align-items:baseline;gap:1rem;flex-wrap:wrap}
.sx-account .sx-badge{display:inline-block;padding:.1rem .5rem;border:1px solid currentColor;border-radius:999px;font-size:.8rem;opacity:.8}
.sx-account img{width:3rem;height:3rem;object-fit:cover;border-radius:.25rem;vertical-align:middle;margin-right:.75rem}
</style>`

const button = (label: string, className = '') =>
  `<button type="submit"${className ? ` class="${className}"` : ''}>${esc(label)}</button>`

const wrap = (inner: string) => `${STYLE}<div class="sx-account">${inner}</div>`

const error = (message: string | null) => (message ? `<p class="sx-error" role="alert">${esc(message)}</p>` : '')

export function loginEmailForm(opts: { email?: string; next: string; error?: string | null }) {
  return wrap(`<h1>Sign in</h1>
<p>Enter your email and we'll send you a code to sign in. No password needed, and your account is created the first time you sign in.</p>
${error(opts.error ?? null)}
<form method="post" action="/account/login">
  <input type="hidden" name="step" value="email">
  <input type="hidden" name="next" value="${esc(opts.next)}">
  <label for="sx-email">Email</label>
  <input id="sx-email" type="email" name="email" value="${esc(opts.email)}" autocomplete="email" inputmode="email" required autofocus>
  ${button('Email me a code')}
</form>`)
}

export function loginCodeForm(opts: { email: string; next: string; error?: string | null }) {
  return wrap(`<h1>Check your email</h1>
<p>We sent a 6-digit code to <strong>${esc(opts.email)}</strong>. It expires in 10 minutes.</p>
${error(opts.error ?? null)}
<form method="post" action="/account/login">
  <input type="hidden" name="step" value="code">
  <input type="hidden" name="email" value="${esc(opts.email)}">
  <input type="hidden" name="next" value="${esc(opts.next)}">
  <label for="sx-code">Code</label>
  <input id="sx-code" class="sx-code" type="text" name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9 ]*" maxlength="12" required autofocus>
  ${button('Sign in')}
</form>
<form method="post" action="/account/login" style="margin-top:1rem">
  <input type="hidden" name="step" value="email">
  <input type="hidden" name="email" value="${esc(opts.email)}">
  <input type="hidden" name="next" value="${esc(opts.next)}">
  ${button('Send a new code', 'sx-link')}
  <span class="sx-note"> · wrong address? <a href="/account/login?next=${encodeURIComponent(opts.next)}">Start over</a></span>
</form>`)
}

const STATUS_LABELS: Record<string, string> = {
  pending: 'Payment pending',
  authorized: 'Payment authorized',
  partially_paid: 'Partially paid',
  paid: 'Paid',
  partially_refunded: 'Partially refunded',
  refunded: 'Refunded',
  voided: 'Voided',
  unfulfilled: 'Not shipped yet',
  partially_fulfilled: 'Partially shipped',
  fulfilled: 'Shipped',
}

function statusOf(order: CustomerOrder) {
  if (order.cancelledAt) return 'Cancelled'
  // Once it's paid, what the customer waits for is the shipment
  return order.financialStatus === 'paid' || order.financialStatus === 'partially_refunded'
    ? (STATUS_LABELS[order.fulfillmentStatus] ?? order.fulfillmentStatus)
    : (STATUS_LABELS[order.financialStatus] ?? order.financialStatus)
}

const date = (iso: string) =>
  new Date(iso).toLocaleDateString('en', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' })

export function accountPage(opts: {
  customer: Customer
  orders: CustomerOrder[]
  nextCursor: string | null
  notice?: string | null
  error?: string | null
}) {
  const { customer, orders } = opts
  const rows = orders
    .map(
      (o) => `<tr>
  <td><a href="/account/orders/${esc(o.id)}">#${esc(o.orderNumber)}</a></td>
  <td>${esc(date(o.createdAt))}</td>
  <td><span class="sx-badge">${esc(statusOf(o))}</span></td>
  <td class="sx-num">${esc(formatMoney(o.totalPrice))}</td>
</tr>`,
    )
    .join('')
  return wrap(`<div class="sx-row">
  <h1>Your account</h1>
  <form method="post" action="/account/logout">${button('Sign out', 'sx-link')}</form>
</div>
${opts.notice ? `<p>${esc(opts.notice)}</p>` : ''}
${error(opts.error ?? null)}
<h2>Orders</h2>
${
  orders.length
    ? `<table><thead><tr><th>Order</th><th>Date</th><th>Status</th><th class="sx-num">Total</th></tr></thead><tbody>${rows}</tbody></table>`
    : `<p>You haven't placed any orders yet. <a href="/products">Start shopping</a></p>`
}
${opts.nextCursor ? `<p style="margin-top:1rem"><a href="/account?after=${encodeURIComponent(opts.nextCursor)}">Older orders</a></p>` : ''}
<h2>Details</h2>
<form method="post" action="/account">
  <p class="sx-note">Signed in as ${esc(customer.email)}</p>
  <label for="sx-name">Name</label>
  <input id="sx-name" type="text" name="name" value="${esc(customer.name)}" autocomplete="name" maxlength="200">
  <label for="sx-phone">Phone</label>
  <input id="sx-phone" type="tel" name="phone" value="${esc(customer.phone)}" autocomplete="tel" maxlength="40">
  ${button('Save')}
</form>`)
}

export function orderPage(order: CustomerOrder) {
  const total = (label: string, value: string) => `<tr><td>${esc(label)}</td><td class="sx-num">${esc(value)}</td></tr>`
  const lines = order.lines
    .map(
      (l) => `<tr>
  <td>${l.image ? `<img src="${esc(l.image.url)}" alt="">` : ''}${esc(l.title)}${l.variantTitle ? ` <span class="sx-note">· ${esc(l.variantTitle)}</span>` : ''} × ${esc(l.quantity)}</td>
  <td class="sx-num">${esc(formatMoney(l.totalPrice))}</td>
</tr>`,
    )
    .join('')
  const a = order.shippingAddress
  const tracking = order.fulfillments
    .filter((f) => f.trackingNumber || f.trackingUrl)
    .map((f) => {
      const label = [f.trackingCompany, f.trackingNumber].filter(Boolean).join(' ')
      const href = f.trackingUrl && /^https?:\/\//i.test(f.trackingUrl) ? f.trackingUrl : null
      return `<p>${href ? `<a href="${esc(href)}" rel="noopener">${esc(label || 'Track your package')}</a>` : esc(label)}</p>`
    })
    .join('')
  return wrap(`<p><a href="/account">← Your account</a></p>
<div class="sx-row"><h1>Order #${esc(order.orderNumber)}</h1><span class="sx-badge">${esc(statusOf(order))}</span></div>
<p class="sx-note">Placed on ${esc(date(order.createdAt))}</p>
${order.paymentInstructions ? `<h2>How to pay${order.paymentMethod ? ` (${esc(order.paymentMethod)})` : ''}</h2><p style="white-space:pre-line">${esc(order.paymentInstructions)}</p>` : ''}
${tracking ? `<h2>Tracking</h2>${tracking}` : ''}
<h2>Items</h2>
<table><tbody>${lines}</tbody></table>
<table style="margin-top:1rem"><tbody>
  ${total('Subtotal', formatMoney(order.subtotalPrice))}
  ${order.totalDiscounts.amountMinor > 0 ? total('Discounts', `−${formatMoney(order.totalDiscounts)}`) : ''}
  ${total('Shipping', formatMoney(order.shippingPrice))}
  ${order.totalTax.amountMinor > 0 ? total('Tax', formatMoney(order.totalTax)) : ''}
  <tr><td><strong>Total</strong></td><td class="sx-num"><strong>${esc(formatMoney(order.totalPrice))}</strong></td></tr>
</tbody></table>
${
  a
    ? `<h2>Shipping address</h2><p>${[
        a.name,
        a.company,
        a.address1,
        a.address2,
        [a.zip, a.city].filter(Boolean).join(' '),
        a.province,
        a.countryCode,
      ]
        .filter(Boolean)
        .map(esc)
        .join('<br>')}</p>`
    : ''
}`)
}

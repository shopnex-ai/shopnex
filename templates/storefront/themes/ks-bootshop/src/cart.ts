// The cart drawer and the toast for cart errors (snippets/cart-drawer.liquid). The cart itself is
// @shopnex/storefront-sdk/cart (Storefront API); checkout is Shopnex's hosted page. Anything with
// data-add-to-cart="{variant id}" adds that variant, and data-cart-open opens the drawer.
import {
  $cart,
  $cartError,
  $cartOpen,
  addToCart,
  loadCart,
  reportCartError,
  setLineQuantity,
  type Cart,
} from '@shopnex/storefront-sdk/cart'
import { formatMoney } from '@shopnex/storefront-sdk/money'

const $ = <T extends HTMLElement = HTMLElement>(s: string) => document.querySelector<T>(s)!
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const modal = $('[data-cart-modal]')
const pending = new Set<string>()

function renderCart(cart: Cart | null) {
  const lines = cart?.lines ?? []
  document.querySelectorAll('[data-cart-count]').forEach((el) => (el.textContent = String(cart?.totalQuantity ?? 0)))
  $('[data-cart-lines]').innerHTML = lines.length
    ? lines
        .map((line) => {
          const m = line.merchandise
          const href = `/products/${encodeURIComponent(m.product.handle)}?variant=${encodeURIComponent(m.id)}`
          const image = m.image
            ? `<img src="${esc(m.image.url)}" alt="${esc(m.image.altText ?? m.product.title)}" loading="lazy">`
            : ''
          return `
          <div class="ks-line${pending.has(line.id) ? ' ks-line-pending' : ''}">
            <a href="${href}" class="ks-line-image">${image}</a>
            <div class="ks-line-info">
              <a href="${href}" class="ks-line-title">${esc(m.product.title)}</a>
              ${m.selectedOptions.length ? `<span class="small text-body-secondary">${esc(m.title)}</span>` : ''}
              ${line.availableForSale ? '' : '<span class="small text-danger">Not enough in stock</span>'}
              <div class="ks-line-qty">
                <button type="button" class="btn btn-outline-secondary btn-sm" data-line-qty="${line.id}" data-qty="${line.quantity - 1}" aria-label="${line.quantity === 1 ? 'Remove' : 'One fewer'}">−</button>
                <span>${line.quantity}</span>
                <button type="button" class="btn btn-outline-secondary btn-sm" data-line-qty="${line.id}" data-qty="${line.quantity + 1}" aria-label="One more">+</button>
                <button type="button" class="btn btn-link btn-sm ms-auto" data-line-qty="${line.id}" data-qty="0">Remove</button>
              </div>
            </div>
            <span class="ks-line-total">${formatMoney(line.cost.totalAmount)}</span>
          </div>`
        })
        .join('')
    : '<p class="text-body-secondary py-3 m-0">Your cart is empty.</p>'

  $('[data-cart-summary]').hidden = lines.length === 0
  if (!cart || !lines.length) return
  $('[data-cart-discounts]').innerHTML = cart.discountAllocations
    .map(
      (d) => `
        <div class="d-flex justify-content-between small mb-2">
          <span>Discount (${esc(d.code)})</span><span>−${formatMoney(d.discountedAmount)}</span>
        </div>`,
    )
    .join('')
  $('[data-cart-total]').textContent = formatMoney(cart.cost.totalAmount)
  $<HTMLAnchorElement>('[data-cart-checkout]').href = cart.checkoutUrl
}

// ── open / close ──
$cartOpen.subscribe((open) => {
  modal.classList.toggle('open', open)
  document.body.style.overflow = open ? 'hidden' : ''
})
modal.addEventListener('click', (e) => {
  if (e.target === modal || (e.target as HTMLElement).closest('[data-cart-close]')) $cartOpen.set(false)
})
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') $cartOpen.set(false)
})

// ── toast ──
let toastTimer: number
$cartError.subscribe((message) => {
  const toast = $('[data-toast]')
  toast.textContent = message ?? ''
  toast.hidden = !message
  clearTimeout(toastTimer)
  if (message) toastTimer = window.setTimeout(() => $cartError.set(null), 4000)
})

// ── actions ──
document.addEventListener('click', async (e) => {
  const t = e.target as HTMLElement
  if (t.closest('[data-cart-open]')) return $cartOpen.set(true)

  const add = t.closest<HTMLButtonElement>('[data-add-to-cart]')
  if (add && !add.disabled) {
    const label = add.innerHTML
    add.disabled = true
    add.textContent = 'Adding…'
    try {
      await addToCart(add.dataset.addToCart!)
    } catch (error) {
      reportCartError(error)
    } finally {
      add.disabled = false
      add.innerHTML = label
    }
    return
  }

  const qty = t.closest<HTMLElement>('[data-line-qty]')
  if (qty) {
    const id = qty.dataset.lineQty!
    if (pending.has(id)) return
    pending.add(id)
    renderCart($cart.get())
    try {
      await setLineQuantity(id, Number(qty.dataset.qty))
    } catch (error) {
      reportCartError(error)
    } finally {
      pending.delete(id)
      renderCart($cart.get())
    }
  }
})

$cart.subscribe(renderCart)
loadCart()

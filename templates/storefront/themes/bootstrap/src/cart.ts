// The cart offcanvas and the toast for cart errors (snippets/cart.liquid). The cart itself is
// @shopnex/storefront-sdk/cart (Storefront API); checkout is ShopNex's hosted page. Anything with
// data-add-to-cart="{variant id}" adds that variant (with the quantity of a [data-quantity] input next to it),
// and data-cart-open opens the cart.
import { Offcanvas, Toast } from 'bootstrap'
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

const panel = $('[data-cart]')
const offcanvas = Offcanvas.getOrCreateInstance(panel)
const toastEl = $('[data-toast]')
const toast = Toast.getOrCreateInstance(toastEl, { delay: 4000 })
const pending = new Set<string>()

function renderCart(cart: Cart | null) {
  const lines = cart?.lines ?? []
  document.querySelectorAll<HTMLElement>('[data-cart-count]').forEach((el) => {
    el.textContent = String(cart?.totalQuantity ?? 0)
    el.hidden = !cart?.totalQuantity
  })
  $('[data-cart-lines]').innerHTML = lines.length
    ? `<ul class="list-group list-group-flush">${lines
        .map((line) => {
          const m = line.merchandise
          const href = `/products/${encodeURIComponent(m.product.handle)}?variant=${encodeURIComponent(m.id)}`
          const image = m.image
            ? `<img src="${esc(m.image.url)}" alt="${esc(m.image.altText ?? m.product.title)}" loading="lazy">`
            : ''
          return `
          <li class="list-group-item px-0 snippet-cart__line${pending.has(line.id) ? ' opacity-50' : ''}">
            <a href="${href}" class="snippet-cart__line-image">${image}</a>
            <div class="flex-grow-1 min-w-0">
              <div class="d-flex justify-content-between gap-2">
                <a href="${href}" class="fw-semibold text-reset text-decoration-none">${esc(m.product.title)}</a>
                <span class="text-nowrap">${formatMoney(line.cost.totalAmount)}</span>
              </div>
              ${m.selectedOptions.length ? `<div class="small text-body-secondary">${esc(m.title)}</div>` : ''}
              ${line.availableForSale ? '' : '<div class="small text-danger">Not enough in stock</div>'}
              <div class="d-flex align-items-center gap-2 mt-2">
                <div class="btn-group btn-group-sm" role="group" aria-label="Quantity">
                  <button type="button" class="btn btn-outline-secondary" data-line-qty="${line.id}" data-qty="${line.quantity - 1}" aria-label="${line.quantity === 1 ? 'Remove' : 'One fewer'}">−</button>
                  <span class="btn btn-outline-secondary disabled text-body" aria-live="polite">${line.quantity}</span>
                  <button type="button" class="btn btn-outline-secondary" data-line-qty="${line.id}" data-qty="${line.quantity + 1}" aria-label="One more">+</button>
                </div>
                <button type="button" class="btn btn-link btn-sm ms-auto" data-line-qty="${line.id}" data-qty="0">Remove</button>
              </div>
            </div>
          </li>`
        })
        .join('')}</ul>`
    : '<p class="text-body-secondary">Your cart is empty.</p>'

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

// ── open / close: the store's $cartOpen and Bootstrap's offcanvas follow each other ──
$cartOpen.subscribe((open) => (open ? offcanvas.show() : offcanvas.hide()))
panel.addEventListener('hidden.bs.offcanvas', () => $cartOpen.set(false))
panel.addEventListener('shown.bs.offcanvas', () => $cartOpen.set(true))

// ── toast ──
$cartError.subscribe((message) => {
  if (!message) return toast.hide()
  $('[data-toast-message]').textContent = message
  toast.show()
})
toastEl.addEventListener('hidden.bs.toast', () => $cartError.set(null))

// ── actions ──
document.addEventListener('click', async (e) => {
  const t = e.target as HTMLElement
  if (t.closest('[data-cart-open]')) return $cartOpen.set(true)

  const add = t.closest<HTMLButtonElement>('[data-add-to-cart]')
  if (add && !add.disabled) {
    const label = add.innerHTML
    const quantityInput = add.closest('[data-product-form]')?.querySelector<HTMLInputElement>('[data-quantity]')
    const quantity = Math.max(1, Math.min(99, Math.floor(Number(quantityInput?.value) || 1)))
    add.disabled = true
    add.textContent = 'Adding…'
    try {
      await addToCart(add.dataset.addToCart!, quantity)
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

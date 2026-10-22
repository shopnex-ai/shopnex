// The cart drawer, its promo code box and the toast for cart errors (snippets/cart-drawer.liquid). The cart
// itself is @shopnex/storefront-sdk/cart (Storefront API); checkout is Shopnex's hosted page. Anything with
// data-add-to-cart="{variant id}" adds that variant (as many as the [data-qty-value] in its product form
// says), and data-cart-open opens the drawer.
import {
  $cart,
  $cartError,
  $cartOpen,
  addToCart,
  loadCart,
  reportCartError,
  setDiscountCode,
  setLineQuantity,
  type Cart,
} from '@shopnex/storefront-sdk/cart'
import { formatMoney } from '@shopnex/storefront-sdk/money'

const $ = <T extends HTMLElement = HTMLElement>(s: string) => document.querySelector<T>(s)!
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const svg = (path: string, cls = 'h-4 w-4') =>
  `<svg class="${cls} flex-none" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`
const icons = {
  minus: svg('<path d="M5 12h14" />'),
  plus: svg('<path d="M12 5v14M5 12h14" />'),
  trash: svg('<path d="M4 7h16M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13M10 11v5.5M14 11v5.5" />', 'h-5 w-5'),
}

const modal = $('[data-cart-modal]')
const pending = new Set<string>()

function renderCart(cart: Cart | null) {
  const lines = cart?.lines ?? []
  document.querySelectorAll<HTMLElement>('[data-cart-count]').forEach((el) => {
    el.textContent = String(cart?.totalQuantity ?? 0)
    el.classList.toggle('show', (cart?.totalQuantity ?? 0) > 0)
  })
  $('[data-cart-lines]').innerHTML = lines.length
    ? `<div class="flex flex-col rounded-[20px] border border-line px-4 sm:px-5">${lines
        .map((line, i) => {
          const m = line.merchandise
          const href = `/products/${encodeURIComponent(m.product.handle)}?variant=${encodeURIComponent(m.id)}`
          const image = m.image
            ? `<img src="${esc(m.image.url)}" alt="${esc(m.image.altText ?? m.product.title)}" class="h-full w-full object-cover" loading="lazy" />`
            : ''
          const options = m.selectedOptions
            .map((o) => `<span>${esc(o.name)}: <span class="text-soft">${esc(o.value)}</span></span>`)
            .join('')
          return `
          <div class="flex gap-3.5 py-4 ${i ? 'border-t border-line' : ''} ${pending.has(line.id) ? 'opacity-50' : ''}">
            <a href="${href}" class="block h-[99px] w-[99px] flex-none overflow-hidden rounded-[9px] bg-photo">${image}</a>
            <div class="flex min-w-0 flex-1 flex-col">
              <div class="flex items-start gap-2">
                <a href="${href}" class="min-w-0 flex-1 text-[16px] leading-snug font-bold">${esc(m.product.title)}</a>
                <button type="button" data-line-qty="${line.id}" data-qty="0" aria-label="Remove" class="cursor-pointer text-sale">${icons.trash}</button>
              </div>
              <div class="flex flex-col text-[12px]">${options}</div>
              ${line.availableForSale ? '' : '<span class="text-[12px] text-sale">Not enough in stock</span>'}
              <div class="mt-auto flex items-center gap-2 pt-2">
                <span class="flex-1 text-[20px] font-bold">${formatMoney(line.cost.totalAmount)}</span>
                <div class="flex items-center gap-4 rounded-full bg-surface px-4 py-2">
                  <button type="button" data-line-qty="${line.id}" data-qty="${line.quantity - 1}" aria-label="${line.quantity === 1 ? 'Remove' : 'One fewer'}" class="cursor-pointer">${icons.minus}</button>
                  <span class="min-w-[2ch] text-center text-[14px] font-medium">${line.quantity}</span>
                  <button type="button" data-line-qty="${line.id}" data-qty="${line.quantity + 1}" aria-label="One more" class="cursor-pointer">${icons.plus}</button>
                </div>
              </div>
            </div>
          </div>`
        })
        .join('')}</div>`
    : `<div class="flex flex-col items-start gap-4 py-4">
         <p class="m-0 text-[16px] text-soft">Your cart is empty.</p>
         <a href="/products" class="btn">Start shopping</a>
       </div>`

  $('[data-cart-summary]').classList.toggle('show', lines.length > 0)
  if (!cart || !lines.length) return
  $('[data-cart-subtotal]').textContent = formatMoney(cart.cost.subtotalAmount)
  $('[data-cart-discounts]').innerHTML = cart.discountAllocations
    .map(
      (d) => `
        <div class="flex items-center justify-between">
          <span class="flex items-center gap-2 text-soft">Discount (${esc(d.code)})
            <button type="button" data-discount-remove class="cursor-pointer text-[13px] underline">Remove</button>
          </span>
          <span class="font-bold text-sale">−${formatMoney(d.discountedAmount)}</span>
        </div>`,
    )
    .join('')
  $('[data-cart-total]').textContent = formatMoney(cart.cost.totalAmount)
  $<HTMLAnchorElement>('[data-cart-checkout]').href = cart.checkoutUrl

  const notApplicable = cart.discountCodes.find((c) => !c.applicable)
  const note = $('[data-discount-note]')
  note.textContent = notApplicable ? `“${notApplicable.code}” can’t be applied to this cart.` : ''
  note.classList.toggle('show', !!notApplicable)
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
  toast.classList.toggle('hidden', !message)
  clearTimeout(toastTimer)
  if (message) toastTimer = window.setTimeout(() => $cartError.set(null), 4000)
})

// ── actions ──
document.addEventListener('click', async (e) => {
  const t = e.target as HTMLElement
  if (t.closest('[data-cart-open]')) return $cartOpen.set(true)

  const add = t.closest<HTMLButtonElement>('[data-add-to-cart]')
  if (add && !add.disabled) {
    const quantity = Number(add.closest('[data-product-form]')?.querySelector('[data-qty-value]')?.textContent) || 1
    const label = add.innerHTML
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

  if (t.closest('[data-discount-remove]')) {
    try {
      await setDiscountCode('')
    } catch (error) {
      reportCartError(error)
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

$<HTMLFormElement>('[data-discount-form]').addEventListener('submit', async (e) => {
  e.preventDefault()
  const form = e.currentTarget as HTMLFormElement
  const input = form.elements.namedItem('code') as HTMLInputElement
  const button = form.querySelector<HTMLButtonElement>('button[type="submit"]')!
  if (!input.value.trim()) return
  button.disabled = true
  try {
    await setDiscountCode(input.value)
    input.value = ''
  } catch (error) {
    reportCartError(error)
  } finally {
    button.disabled = false
  }
})

$cart.subscribe(renderCart)
loadCart()

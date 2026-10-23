// The cart drawer, its discount code box and the toast for cart errors (snippets/cart-drawer.liquid). The cart
// itself is @shopnex/storefront-sdk/cart (Storefront API); checkout is Shopnex's hosted page. Anything with
// data-add-to-cart="{variant id}" adds that variant, and data-cart-open opens the drawer.
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
const svg = (path: string) =>
  `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`
const icons = {
  minus: svg('<path d="M5 12h14" />'),
  plus: svg('<path d="M12 5v14M5 12h14" />'),
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
    ? `<div class="grid gap-6 md:gap-10">${lines
        .map((line) => {
          const m = line.merchandise
          const href = `/products/${encodeURIComponent(m.product.handle)}?variant=${encodeURIComponent(m.id)}`
          const image = m.image
            ? `<img src="${esc(m.image.url)}" alt="${esc(m.image.altText ?? m.product.title)}" class="h-24 w-24 rounded border border-primary/10 object-cover object-center md:h-28 md:w-28" loading="lazy" />`
            : ''
          const options = m.selectedOptions
            .filter((o) => o.value !== 'Default Title')
            .map((o) => `<div class="flex text-primary/50"><dt>${esc(o.name)}:&nbsp;</dt><dd>${esc(o.value)}</dd></div>`)
            .join('')
          return `
          <div class="grid grid-cols-[auto_1fr] gap-4 ${pending.has(line.id) ? 'opacity-50' : ''}">
            <a href="${href}" class="block shrink">${image}</a>
            <div class="flex grow justify-between gap-2">
              <div class="grid content-start gap-2">
                <h3 class="m-0 max-w-prose text-copy font-bold"><a href="${href}">${esc(m.product.title)}</a></h3>
                <dl class="m-0 grid">${options}</dl>
                ${line.availableForSale ? '' : '<span class="text-fine text-accent">Not enough in stock</span>'}
                <div class="flex items-center gap-3 pt-1">
                  <button type="button" data-line-qty="${line.id}" data-qty="${line.quantity - 1}" aria-label="${line.quantity === 1 ? 'Remove' : 'One fewer'}" class="cursor-pointer">${icons.minus}</button>
                  <span class="min-w-[2ch] text-center">${line.quantity}</span>
                  <button type="button" data-line-qty="${line.id}" data-qty="${line.quantity + 1}" aria-label="One more" class="cursor-pointer">${icons.plus}</button>
                </div>
              </div>
              <div class="flex flex-col items-end justify-between">
                <span>${formatMoney(line.cost.totalAmount)}</span>
                <button type="button" data-line-qty="${line.id}" data-qty="0" class="cursor-pointer text-fine underline underline-offset-4 opacity-60 hover:opacity-100">Remove</button>
              </div>
            </div>
          </div>`
        })
        .join('')}</div>`
    : `<div class="grid justify-items-start gap-4">
         <p class="m-0 text-copy">Looks like you haven’t added anything yet, let’s get you started!</p>
         <a href="/products" class="btn">Continue shopping</a>
       </div>`

  $('[data-cart-summary]').classList.toggle('show', lines.length > 0)
  if (!cart || !lines.length) return
  $('[data-cart-subtotal]').textContent = formatMoney(cart.cost.subtotalAmount)
  $('[data-cart-discounts]').innerHTML = cart.discountAllocations
    .map(
      (d) => `
        <div class="flex items-center justify-between text-copy">
          <span class="flex items-center gap-2">Discount (${esc(d.code)})
            <button type="button" data-discount-remove class="cursor-pointer text-fine underline underline-offset-4">Remove</button>
          </span>
          <span>−${formatMoney(d.discountedAmount)}</span>
        </div>`,
    )
    .join('')
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
    const label = add.innerHTML
    add.disabled = true
    add.textContent = 'Adding…'
    try {
      await addToCart(add.dataset.addToCart!, 1)
      $cartOpen.set(true)
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

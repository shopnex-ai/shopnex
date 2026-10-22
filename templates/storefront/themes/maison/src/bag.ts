// The bag drawer and the toast for cart errors (snippets/bag.liquid). The cart itself is
// @shopnex/storefront-sdk/cart (Storefront API); checkout is Shopnex's hosted page. Anything with
// data-add-to-bag="{variant id}" adds that variant, and data-bag-open opens the drawer.
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

const modal = $('[data-bag-modal]')
const pending = new Set<string>()

function renderBag(cart: Cart | null) {
  const lines = cart?.lines ?? []
  document.querySelectorAll('[data-bag-count]').forEach((el) => (el.textContent = String(cart?.totalQuantity ?? 0)))
  $('[data-bag-lines]').innerHTML = lines.length
    ? lines
        .map((line) => {
          const m = line.merchandise
          const href = `/products/${encodeURIComponent(m.product.handle)}?variant=${encodeURIComponent(m.id)}`
          const image = m.image
            ? `<img src="${esc(m.image.url)}" alt="${esc(m.image.altText ?? m.product.title)}" class="h-full w-full object-cover" loading="lazy" />`
            : ''
          return `
          <div class="flex items-start gap-x-[18px] border-t border-line py-4 ${pending.has(line.id) ? 'opacity-60' : ''}">
            <a href="${href}" class="hatch block aspect-[4/5] w-[58px] flex-none overflow-hidden border border-line">${image}</a>
            <div class="flex min-w-0 flex-1 flex-col gap-1.5">
              <a href="${href}" class="font-sf text-[17px] leading-[1.3]">${esc(m.product.title)}</a>
              ${m.selectedOptions.length ? `<span class="text-[12.5px] text-muted">${esc(m.title)}</span>` : ''}
              ${line.availableForSale ? '' : '<span class="text-[12.5px] text-acc">Not enough in stock</span>'}
              <div class="eti flex items-center gap-3" style="font-size:10.5px">
                <button type="button" data-line-qty="${line.id}" data-qty="${line.quantity - 1}" aria-label="${line.quantity === 1 ? 'Remove' : 'One fewer'}" class="cursor-pointer text-soft hover:text-acc">−</button>
                <span class="font-mono text-ink">${line.quantity}</span>
                <button type="button" data-line-qty="${line.id}" data-qty="${line.quantity + 1}" aria-label="One more" class="cursor-pointer text-soft hover:text-acc">+</button>
                <span class="flex-1"></span>
                <button type="button" data-line-qty="${line.id}" data-qty="0" class="cursor-pointer text-faint hover:text-acc">Remove</button>
              </div>
            </div>
            <span class="font-mono text-[13px]">${formatMoney(line.cost.totalAmount)}</span>
          </div>`
        })
        .join('')
    : '<p class="m-0 py-4 text-[14px] leading-[1.7] text-muted">The bag is empty. Add a piece from the archive and it waits here.</p>'

  $('[data-bag-summary]').classList.toggle('show', lines.length > 0)
  $('[data-bag-checkout]').classList.toggle('show', lines.length > 0)
  if (!cart || !lines.length) return
  $('[data-bag-discounts]').innerHTML = cart.discountAllocations
    .map(
      (d) => `
        <div class="flex items-center gap-4 text-[13px] text-soft">
          <span>Discount (${esc(d.code)})</span><span class="flex-1"></span>
          <span class="font-mono">−${formatMoney(d.discountedAmount)}</span>
        </div>`,
    )
    .join('')
  $('[data-bag-total]').textContent = formatMoney(cart.cost.totalAmount)
  $<HTMLAnchorElement>('[data-bag-checkout]').href = cart.checkoutUrl
}

// ── open / close ──
$cartOpen.subscribe((open) => {
  modal.classList.toggle('open', open)
  document.body.style.overflow = open ? 'hidden' : ''
})
modal.addEventListener('click', (e) => {
  if (e.target === modal || (e.target as HTMLElement).closest('[data-bag-close]')) $cartOpen.set(false)
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
  if (t.closest('[data-bag-open]')) return $cartOpen.set(true)

  const add = t.closest<HTMLButtonElement>('[data-add-to-bag]')
  if (add && !add.disabled) {
    const label = add.innerHTML
    add.disabled = true
    add.textContent = 'Adding…'
    try {
      await addToCart(add.dataset.addToBag!)
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
    renderBag($cart.get())
    try {
      await setLineQuantity(id, Number(qty.dataset.qty))
    } catch (error) {
      reportCartError(error)
    } finally {
      pending.delete(id)
      renderBag($cart.get())
    }
  }
})

$cart.subscribe(renderBag)
loadCart()

// The product page's pickers (templates/product.liquid): the chosen variant's price, saving, availability and
// image follow the buyer's choices, and it's kept in the URL (?variant=id). Also the quantity stepper and the
// gallery's thumbnails.
import type { Product, ProductVariant } from '@shopnex/storefront-sdk'
import { formatMoney } from '@shopnex/storefront-sdk/money'

const MAX_QUANTITY = 99

const form = document.querySelector<HTMLElement>('[data-product-form]')
if (form) {
  const product = JSON.parse(form.querySelector('[data-product-json]')!.textContent!) as Product
  const q = <T extends HTMLElement = HTMLElement>(s: string) => form.querySelector<T>(s)
  const mainImage = q<HTMLImageElement>('[data-main-image]')
  const addButton = q<HTMLButtonElement>('[data-add-to-cart]')!
  const optionButtons = [...form.querySelectorAll<HTMLButtonElement>('[data-option]')]
  const selection: Record<string, string> = {}
  for (const b of optionButtons)
    if (b.getAttribute('aria-pressed') === 'true') selection[b.dataset.option!] = b.dataset.value!

  const matches = (v: ProductVariant, s: Record<string, string>) =>
    v.selectedOptions.every((o) => s[o.name] === o.value)

  function showImage(url: string) {
    if (mainImage) mainImage.src = url
    form!.querySelectorAll<HTMLElement>('[data-thumb]').forEach((t) => {
      t.classList.toggle('border-ink', t.dataset.thumb === url)
      t.classList.toggle('border-transparent', t.dataset.thumb !== url)
    })
  }

  function paint(updateUrl = true) {
    const variant = product.variants.find((v) => matches(v, selection))
    for (const b of optionButtons) {
      const name = b.dataset.option!
      b.setAttribute('aria-pressed', String(selection[name] === b.dataset.value))
      // A value is available when a variant with it (and the other current choices) can be bought
      const canBuy = product.variants.some(
        (v) => v.availableForSale && matches(v, { ...selection, [name]: b.dataset.value! }),
      )
      b.toggleAttribute('data-unavailable', !canBuy)
    }
    form!.querySelectorAll<HTMLElement>('[data-selected-value]').forEach((el) => {
      el.textContent = selection[el.dataset.selectedValue!] ?? ''
    })
    q('[data-add-label]')!.textContent = !variant ? 'Unavailable' : variant.availableForSale ? 'Add to cart' : 'Sold out'
    addButton.disabled = !variant?.availableForSale
    if (!variant) return
    addButton.dataset.addToCart = variant.id
    q('[data-price]')!.textContent = formatMoney(variant.price)
    const compareAt = variant.compareAtPrice
    const onSale = !!compareAt && compareAt.amountMinor > variant.price.amountMinor
    const compareAtEl = q('[data-compare-at]')!
    const savingEl = q('[data-saving]')!
    compareAtEl.textContent = onSale ? formatMoney(compareAt) : ''
    savingEl.textContent = onSale
      ? `-${Math.round(((compareAt.amountMinor - variant.price.amountMinor) * 100) / compareAt.amountMinor)}%`
      : ''
    compareAtEl.classList.toggle('hidden', !onSale)
    savingEl.classList.toggle('hidden', !onSale)
    if (variant.image) showImage(new URL(variant.image.url, location.href).href)
    if (!updateUrl) return
    const url = new URL(location.href)
    url.searchParams.set('variant', variant.id)
    history.replaceState(null, '', url)
  }

  form.addEventListener('click', (e) => {
    const t = e.target as HTMLElement
    const option = t.closest<HTMLButtonElement>('[data-option]')
    if (option) {
      selection[option.dataset.option!] = option.dataset.value!
      return paint()
    }
    const thumb = t.closest<HTMLElement>('[data-thumb]')
    if (thumb) return showImage(thumb.dataset.thumb!)
    const step = t.closest<HTMLElement>('[data-qty-step]')
    if (step) {
      const value = q('[data-qty-value]')!
      const next = Number(value.textContent) + Number(step.dataset.qtyStep)
      value.textContent = String(Math.min(MAX_QUANTITY, Math.max(1, next)))
    }
  })
  paint(false)
}

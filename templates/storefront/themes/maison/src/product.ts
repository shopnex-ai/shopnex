// The product page's option pickers (templates/product.liquid): the chosen variant's price, SKU, availability
// and image follow the buyer's choices, and it's kept in the URL (?variant=id).
import type { Product, ProductVariant } from '@shopnex/storefront-sdk'
import { formatMoney } from '@shopnex/storefront-sdk/money'

const form = document.querySelector<HTMLElement>('[data-product-form]')
if (form) {
  const product = JSON.parse(form.querySelector('[data-product-json]')!.textContent!) as Product
  const q = <T extends HTMLElement = HTMLElement>(s: string) => form.querySelector<T>(s)
  const mainImage = q<HTMLImageElement>('[data-main-image]')
  const addButton = q<HTMLButtonElement>('[data-add-to-bag]')!
  const optionButtons = [...form.querySelectorAll<HTMLButtonElement>('[data-option]')]
  const selection: Record<string, string> = {}
  for (const b of optionButtons)
    if (b.getAttribute('aria-pressed') === 'true') selection[b.dataset.option!] = b.dataset.value!

  const matches = (v: ProductVariant, s: Record<string, string>) =>
    v.selectedOptions.every((o) => s[o.name] === o.value)

  function showImage(url: string) {
    if (mainImage) mainImage.src = url
    form!.querySelectorAll<HTMLElement>('[data-thumb]').forEach((t) => {
      t.classList.toggle('border-acc', t.dataset.thumb === url)
      t.classList.toggle('border-line', t.dataset.thumb !== url)
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
    q('[data-add-label]')!.textContent = !variant ? 'Unavailable' : variant.availableForSale ? 'Add to bag' : 'Sold out'
    addButton.disabled = !variant?.availableForSale
    if (!variant) return
    addButton.dataset.addToBag = variant.id
    q('[data-price]')!.textContent = formatMoney(variant.price)
    const compareAt =
      variant.compareAtPrice && variant.compareAtPrice.amountMinor > variant.price.amountMinor
        ? formatMoney(variant.compareAtPrice)
        : null
    const compareAtEl = q('[data-compare-at]')!
    compareAtEl.textContent = compareAt ?? ''
    compareAtEl.classList.toggle('hidden', !compareAt)
    q('[data-spec="sku"]')!.textContent = variant.sku ?? ''
    q('[data-spec-row="sku"]')!.classList.toggle('hidden', !variant.sku)
    q('[data-spec="availability"]')!.textContent = variant.availableForSale ? 'Available' : 'Sold out'
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
    if (thumb) showImage(thumb.dataset.thumb!)
  })
  paint(false)
}

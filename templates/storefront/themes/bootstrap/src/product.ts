// The product page's option selects (templates/product.liquid): the chosen variant's price, SKU, availability
// and image follow the buyer's choices, and it's kept in the URL (?variant=id). Values that can't be bought
// with the other current choices are marked "(sold out)".
import { Carousel } from 'bootstrap'
import type { Product, ProductVariant } from '@shopnex/storefront-sdk'
import { formatMoney } from '@shopnex/storefront-sdk/money'

const form = document.querySelector<HTMLElement>('[data-product-form]')
if (form) {
  const product = JSON.parse(form.querySelector('[data-product-json]')!.textContent!) as Product
  const q = <T extends HTMLElement = HTMLElement>(s: string) => form.querySelector<T>(s)
  const addButton = q<HTMLButtonElement>('[data-add-to-cart]')!
  const selects = [...form.querySelectorAll<HTMLSelectElement>('select[data-option]')]
  const gallery = q('[data-product-gallery]')
  const slides = [...form.querySelectorAll<HTMLElement>('[data-image]')]

  const selection = () => Object.fromEntries(selects.map((s) => [s.dataset.option!, s.value]))
  const matches = (v: ProductVariant, s: Record<string, string>) =>
    v.selectedOptions.every((o) => s[o.name] === o.value)

  function showImage(url: string) {
    const index = slides.findIndex((s) => s.dataset.image === url)
    if (gallery && index >= 0) Carousel.getOrCreateInstance(gallery, { ride: false }).to(index)
  }

  function paint(updateUrl = true) {
    const current = selection()
    const variant = product.variants.find((v) => matches(v, current))
    for (const select of selects) {
      const name = select.dataset.option!
      for (const option of select.options) {
        const canBuy = product.variants.some(
          (v) => v.availableForSale && matches(v, { ...current, [name]: option.value }),
        )
        option.textContent = canBuy ? option.value : `${option.value} (sold out)`
      }
    }
    q('[data-add-label]')!.textContent = !variant
      ? 'Unavailable'
      : variant.availableForSale
        ? 'Add to Cart'
        : 'Sold out'
    addButton.disabled = !variant?.availableForSale
    if (!variant) return
    addButton.dataset.addToCart = variant.id
    q('[data-price]')!.textContent = formatMoney(variant.price)
    const compareAt =
      variant.compareAtPrice && variant.compareAtPrice.amountMinor > variant.price.amountMinor
        ? formatMoney(variant.compareAtPrice)
        : null
    const compareAtEl = q('[data-compare-at]')!
    compareAtEl.textContent = compareAt ?? ''
    compareAtEl.classList.toggle('d-none', !compareAt)
    q('[data-spec="sku"]')!.textContent = variant.sku ?? ''
    q('[data-spec-row="sku"]')!.hidden = !variant.sku
    q('[data-spec="availability"]')!.textContent = variant.availableForSale ? 'In stock' : 'Sold out'
    if (variant.image) showImage(new URL(variant.image.url, location.href).href)
    if (!updateUrl) return
    const url = new URL(location.href)
    url.searchParams.set('variant', variant.id)
    history.replaceState(null, '', url)
  }

  for (const select of selects) select.addEventListener('change', () => paint())
  if (selects.length) paint(false)
}

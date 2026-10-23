// The product page's pickers (templates/product.liquid): the chosen variant's price, availability and photo
// follow the buyer's choices, and it's kept in the URL (?variant=id).
import type { Product, ProductVariant } from '@shopnex/storefront-sdk'
import { formatMoney } from '@shopnex/storefront-sdk/money'

const form = document.querySelector<HTMLElement>('[data-product-form]')
if (form) {
  const product = JSON.parse(form.querySelector('[data-product-json]')!.textContent!) as Product
  const q = <T extends HTMLElement = HTMLElement>(s: string) => form.querySelector<T>(s)
  const addButton = q<HTMLButtonElement>('[data-add-to-cart]')!
  const optionButtons = [...form.querySelectorAll<HTMLButtonElement>('[data-option]')]
  const selection: Record<string, string> = {}
  for (const b of optionButtons)
    if (b.getAttribute('aria-pressed') === 'true') selection[b.dataset.option!] = b.dataset.value!

  const matches = (v: ProductVariant, s: Record<string, string>) =>
    v.selectedOptions.every((o) => s[o.name] === o.value)

  // Bring the variant's photo into view in the gallery (no vertical jump: only the swipeable row moves)
  function showImage(url: string) {
    const href = new URL(url, location.href).href
    const slide = [...form!.querySelectorAll<HTMLElement>('[data-gallery-image]')].find(
      (el) => new URL(el.dataset.galleryImage!, location.href).href === href,
    )
    slide?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' })
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
    q('[data-add-label]')!.textContent = !variant ? 'Unavailable' : variant.availableForSale ? 'Add to cart' : 'Sold out'
    addButton.disabled = !variant?.availableForSale
    if (!variant) return
    addButton.dataset.addToCart = variant.id
    q('[data-price]')!.textContent = formatMoney(variant.price)
    const compareAt = variant.compareAtPrice
    const onSale = !!compareAt && compareAt.amountMinor > variant.price.amountMinor
    const compareAtEl = q('[data-compare-at]')!
    compareAtEl.textContent = onSale ? formatMoney(compareAt) : ''
    compareAtEl.classList.toggle('hidden', !onSale)
    if (updateUrl && variant.image) showImage(variant.image.url)
    if (!updateUrl) return
    const url = new URL(location.href)
    url.searchParams.set('variant', variant.id)
    history.replaceState(null, '', url)
  }

  form.addEventListener('click', (e) => {
    const option = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-option]')
    if (!option) return
    selection[option.dataset.option!] = option.dataset.value!
    paint()
  })
  paint(false)
}

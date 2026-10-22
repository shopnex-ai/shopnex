// The product page (templates/product.liquid): the gallery (Swiper with thumbnails, click to zoom) and the
// option pickers. The chosen variant's price and availability follow the buyer's choices, the gallery shows
// its image, and it's kept in the URL (?variant=id).
import type { Product, ProductVariant } from '@shopnex/storefront-sdk'
import { formatMoney } from '@shopnex/storefront-sdk/money'
import Swiper from 'swiper'
import { FreeMode, Navigation, Thumbs } from 'swiper/modules'

const form = document.querySelector<HTMLElement>('[data-product-form]')
if (form) {
  const product = JSON.parse(form.querySelector('[data-product-json]')!.textContent!) as Product
  const gallery = initGallery(form)

  const q = <T extends HTMLElement = HTMLElement>(s: string) => form.querySelector<T>(s)
  const addButton = q<HTMLButtonElement>('[data-add-to-cart]')!
  const optionButtons = [...form.querySelectorAll<HTMLButtonElement>('[data-option]')]
  const selection: Record<string, string> = {}
  for (const b of optionButtons)
    if (b.getAttribute('aria-pressed') === 'true') selection[b.dataset.option!] = b.dataset.value!

  const matches = (v: ProductVariant, s: Record<string, string>) =>
    v.selectedOptions.every((o) => s[o.name] === o.value)

  function paint() {
    const variant = product.variants.find((v) => matches(v, selection))
    for (const b of optionButtons) {
      const name = b.dataset.option!
      const value = b.dataset.value!
      b.setAttribute('aria-pressed', String(selection[name] === value))
      // A value is available when a variant with it (and the other current choices) can be bought
      const canBuy = product.variants.some((v) => v.availableForSale && matches(v, { ...selection, [name]: value }))
      b.toggleAttribute('data-unavailable', !canBuy)
      b.title = canBuy ? `${name} ${value}` : `${name} ${value} (out of stock)`
    }
    q('[data-label]')!.textContent = !variant
      ? 'Unavailable'
      : !variant.availableForSale
        ? 'Out Of Stock'
        : 'Add To Cart'
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
    compareAtEl.classList.toggle('hidden', !compareAt)
    return variant
  }

  form.addEventListener('click', (e) => {
    const option = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-option]')
    if (!option) return
    selection[option.dataset.option!] = option.dataset.value!
    const variant = paint()
    if (!variant) return
    if (variant.image) gallery?.show(variant.image.url)
    const url = new URL(location.href)
    url.searchParams.set('variant', variant.id)
    history.replaceState(null, '', url)
  })
  paint()
}

/** The main images with arrows and thumbnails; `show(url)` slides to an image */
function initGallery(root: HTMLElement) {
  const el = root.querySelector<HTMLElement>('[data-gallery]')
  if (!el) return null
  const thumbsEl = root.querySelector<HTMLElement>('[data-gallery-thumbs]')
  const thumbs = thumbsEl
    ? new Swiper(thumbsEl, {
        modules: [FreeMode],
        spaceBetween: 10,
        slidesPerView: 4,
        freeMode: true,
        watchSlidesProgress: true,
      })
    : null
  const main = new Swiper(el, {
    modules: [FreeMode, Navigation, Thumbs],
    initialSlide: Number(el.dataset.initial ?? 0),
    spaceBetween: 10,
    // Mouse drags would fight the zoom; touch still swipes
    simulateTouch: false,
    thumbs: { swiper: thumbs },
    navigation: {
      prevEl: root.querySelector<HTMLElement>('[data-gallery-prev]'),
      nextEl: root.querySelector<HTMLElement>('[data-gallery-next]'),
    },
  })

  // Click to zoom (2×), following the pointer
  for (const zoom of el.querySelectorAll<HTMLElement>('[data-zoom]')) {
    const lens = zoom.querySelector<HTMLElement>('[data-zoom-lens]')!
    const icon = zoom.querySelector<HTMLElement>('[data-zoom-icon]')
    const setZoomed = (zoomed: boolean) => {
      lens.classList.toggle('hidden', !zoomed)
      icon?.classList.toggle('hidden', zoomed)
      zoom.classList.toggle('cursor-zoom-in', !zoomed)
      zoom.classList.toggle('cursor-zoom-out', zoomed)
    }
    zoom.addEventListener('click', () => setZoomed(lens.classList.contains('hidden')))
    zoom.addEventListener('mouseleave', () => setZoomed(false))
    zoom.addEventListener('mousemove', (e) => {
      const { left, top, width, height } = zoom.getBoundingClientRect()
      const x = Math.max(0, Math.min(1, (e.clientX - left) / width))
      const y = Math.max(0, Math.min(1, (e.clientY - top) / height))
      lens.style.backgroundPosition = `${x * 100}% ${y * 100}%`
    })
  }

  const slides = [...el.querySelectorAll<HTMLElement>('[data-image]')]
  return {
    show(url: string) {
      const index = slides.findIndex((s) => s.dataset.image === url)
      if (index !== -1) main.slideTo(index)
    },
  }
}

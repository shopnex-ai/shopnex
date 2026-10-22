// Add to cart buttons: data-add-to-cart="{variant id}" adds that variant (product cards, the product page),
// showing the spinner (data-spinner) instead of the label (data-label) meanwhile
import { addToCart, reportCartError } from '@shopnex/storefront-sdk/cart'

document.addEventListener('click', async (e) => {
  const button = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-add-to-cart]')
  if (!button || button.disabled) return
  const label = button.querySelector<HTMLElement>('[data-label]')
  const spinner = button.querySelector<HTMLElement>('[data-spinner]')
  button.disabled = true
  label?.toggleAttribute('hidden', true)
  spinner?.toggleAttribute('hidden', false)
  try {
    await addToCart(button.dataset.addToCart!)
  } catch (error) {
    reportCartError(error)
  } finally {
    button.disabled = false
    label?.toggleAttribute('hidden', false)
    spinner?.toggleAttribute('hidden', true)
  }
})

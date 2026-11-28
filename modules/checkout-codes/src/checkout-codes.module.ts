import { defineModule } from '@shopnex/kit'

// No tables or routes of its own: the checkout page calls it. It knows both kinds of code (discounts, gift cards), so it sits above
// cart, pricing and gift-cards (gift cards sit above cart, so neither of those can know the other).
export const checkoutCodesModule = defineModule({
  name: 'checkout-codes',
  dependsOn: ['cart', 'db', 'gift-cards', 'pricing'],
})

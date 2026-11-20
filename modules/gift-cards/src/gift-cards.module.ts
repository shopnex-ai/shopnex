import './gift-cards.hooks'
import { defineModule } from '@shopnex/kit'
import { giftCards as giftCardRoutes } from './gift-cards.router'
import { giftCards, giftCardTransactions } from './gift-cards.schema'

export const giftCardsModule = defineModule({
  name: 'gift-cards',
  dependsOn: ['cart', 'catalog', 'core', 'db', 'orders', 'rpc'],
  tables: { giftCards, giftCardTransactions },
  router: { giftCards: giftCardRoutes },
})

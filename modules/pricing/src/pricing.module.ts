import { defineModule } from '@shopnex/kit'
import { discounts, taxRates } from './pricing.schema'
import { pricingErrors, discounts as discountRoutes, taxRates as taxRateRoutes } from './pricing.router'

export const pricingModule = defineModule({
  name: 'pricing',
  dependsOn: ['db', 'rpc'],
  tables: { discounts, taxRates },
  errors: pricingErrors,
  router: { discounts: discountRoutes, taxRates: taxRateRoutes },
})

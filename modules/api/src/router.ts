import { os } from '@orpc/server'
import { pub, type Context } from './orpc'
import { aiModule } from '@shopnex/ai/module'
import { catalogModule } from '@shopnex/catalog/module'
import { appsModule } from '@shopnex/apps/module'
import { analytics as adminAnalytics } from './routers/admin/analytics'
import { shippingRates as adminShippingRates } from './routers/admin/checkout-settings'
import {
  carrierServices as adminCarrierServices,
  carrierServicesApp as adminCarrierServicesApp,
} from './routers/admin/carrier-services'
import { customFieldsModule } from '@shopnex/custom-fields/module'
import { customers as adminCustomers } from './routers/admin/customers'
import { paymentsModule } from '@shopnex/payments/module'
import { pricingModule } from '@shopnex/pricing/module'
import { filesModule } from '@shopnex/files/module'
import { orders as adminOrders } from './routers/admin/orders'
import { channelsModule } from '@shopnex/channels/module'
import { contentModule } from '@shopnex/content/module'
import { emailModule } from '@shopnex/email/module'
import { tenancyModule } from '@shopnex/tenancy/module'
import { themeModule } from '@shopnex/theme/module'
import { webhooksModule } from '@shopnex/webhooks/module'
import { storefrontRouter } from './routers/storefront'

// Tags group endpoints in the API reference (/api/v1/docs). A bare builder: `.router()` on `pub`/`admin`
// would apply their middleware a second time.
const tagged = (tag: string) => os.$context<Context>().tag(tag)

export const router = {
  health: pub.route({ method: 'GET', path: '/health', tags: ['System'] }).handler(() => ({ ok: true })),
  // Public, contract-first (see @shopnex/storefront-sdk)
  storefront: storefrontRouter,
  // Apps exchange an authorization code for an access token
  oauth: tagged('OAuth').router(appsModule.router.oauth),
  // The app marketplace verifies this instance's URL while connecting
  marketplace: tagged('Marketplace').router(appsModule.router.marketplace),
  admin: {
    shop: tagged('Admin · Shop').router(tenancyModule.router.shop),
    products: tagged('Admin · Products').router(catalogModule.router.products),
    collections: tagged('Admin · Collections').router(catalogModule.router.collections),
    customFields: tagged('Admin · Custom fields').router(customFieldsModule.router),
    customers: tagged('Admin · Customers').router(adminCustomers),
    orders: tagged('Admin · Orders').router(adminOrders),
    analytics: tagged('Admin · Analytics').router(adminAnalytics),
    discounts: tagged('Admin · Discounts').router(pricingModule.router.discounts),
    themes: tagged('Admin · Themes').router(themeModule.router),
    menus: tagged('Admin · Navigation').router(contentModule.router.menus),
    pages: tagged('Admin · Pages').router(contentModule.router.pages),
    files: tagged('Admin · Files').router(filesModule.router.files),
    channels: tagged('Admin · Channels').router(channelsModule.router.channels),
    domains: tagged('Admin · Domains').router(tenancyModule.router.domains),
    storefrontKeys: tagged('Admin · Storefront keys').router(channelsModule.router.storefrontKeys),
    staff: tagged('Admin · Staff').router(tenancyModule.router.staff),
    platform: tagged('Admin · Platform').router(tenancyModule.router.platform),
    storage: tagged('Admin · Storage').router(filesModule.router.storage),
    email: tagged('Admin · Email').router(emailModule.router.email),
    notifications: tagged('Admin · Email').router(emailModule.router.notifications),
    shippingRates: tagged('Admin · Shipping').router(adminShippingRates),
    carrierServices: tagged('Admin · Shipping').router(adminCarrierServices),
    carrierServicesApp: tagged('Admin · Carrier apps').router(adminCarrierServicesApp),
    paymentMethods: tagged('Admin · Payments').router(paymentsModule.router.paymentMethods),
    paymentApps: tagged('Admin · Payments').router(paymentsModule.router.paymentApps),
    paymentsApp: tagged('Admin · Payments apps').router(paymentsModule.router.paymentsApp),
    paymentSessions: tagged('Admin · Payments apps').router(paymentsModule.router.paymentSessions),
    taxRates: tagged('Admin · Taxes').router(pricingModule.router.taxRates),
    ai: tagged('Admin · AI').router(aiModule.router.ai),
    aiSettings: tagged('Admin · AI').router(aiModule.router.aiSettings),
    aiApp: tagged('Admin · AI apps').router(aiModule.router.aiApp),
    webhooks: tagged('Admin · Webhooks').router(webhooksModule.router),
    apiTokens: tagged('Admin · API tokens').router(tenancyModule.router.apiTokens),
    apps: tagged('Admin · Apps').router(appsModule.router.apps),
    appRegistry: tagged('Admin · App registry').router(appsModule.router.appRegistry),
    appData: tagged('Admin · App data').router(appsModule.router.appData),
    marketplace: tagged('Admin · Marketplace').router(appsModule.router.marketplaceConnection),
  },
}

export type Router = typeof router

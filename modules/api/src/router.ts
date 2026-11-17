import { os } from '@orpc/server'
import { pub, type Context } from './orpc'
import { aiModule } from '@shopnex/ai/module'
import { apiTokens as adminApiTokens } from './routers/admin/api-tokens'
import { analytics as adminAnalytics } from './routers/admin/analytics'
import {
  appData as adminAppData,
  appRegistry as adminAppRegistry,
  apps as adminApps,
  marketplaceConnection as adminMarketplace,
} from './routers/admin/apps'
import { shippingRates as adminShippingRates } from './routers/admin/checkout-settings'
import {
  carrierServices as adminCarrierServices,
  carrierServicesApp as adminCarrierServicesApp,
} from './routers/admin/carrier-services'
import { collections as adminCollections } from './routers/admin/collections'
import { customFieldsModule } from '@shopnex/custom-fields/module'
import { customers as adminCustomers } from './routers/admin/customers'
import { paymentsModule } from '@shopnex/payments/module'
import { pricingModule } from '@shopnex/pricing/module'
import { email as adminEmail } from './routers/admin/email'
import { filesModule } from '@shopnex/files/module'
import { menus as adminMenus } from './routers/admin/menus'
import { notifications as adminNotifications } from './routers/admin/notifications'
import { pages as adminPages } from './routers/admin/pages'
import { orders as adminOrders } from './routers/admin/orders'
import { products as adminProducts } from './routers/admin/products'
import { shop as adminShop } from './routers/admin/shop'
import { platform as adminPlatform } from './routers/admin/platform'
import { staff as adminStaff } from './routers/admin/staff'
import { channels as adminChannels } from './routers/admin/channels'
import { domains as adminDomains } from './routers/admin/domains'
import { storefrontKeys as adminStorefrontKeys } from './routers/admin/storefront-keys'
import { themeModule } from '@shopnex/theme/module'
import { webhooks as adminWebhooks } from './routers/admin/webhooks'
import { marketplace } from './routers/marketplace'
import { oauth } from './routers/oauth'
import { storefrontRouter } from './routers/storefront'

// Tags group endpoints in the API reference (/api/v1/docs). A bare builder: `.router()` on `pub`/`admin`
// would apply their middleware a second time.
const tagged = (tag: string) => os.$context<Context>().tag(tag)

export const router = {
  health: pub.route({ method: 'GET', path: '/health', tags: ['System'] }).handler(() => ({ ok: true })),
  // Public, contract-first (see @shopnex/storefront-sdk)
  storefront: storefrontRouter,
  // Apps exchange an authorization code for an access token
  oauth: tagged('OAuth').router(oauth),
  // The app marketplace verifies this instance's URL while connecting
  marketplace: tagged('Marketplace').router(marketplace),
  admin: {
    shop: tagged('Admin · Shop').router(adminShop),
    products: tagged('Admin · Products').router(adminProducts),
    collections: tagged('Admin · Collections').router(adminCollections),
    customFields: tagged('Admin · Custom fields').router(customFieldsModule.router),
    customers: tagged('Admin · Customers').router(adminCustomers),
    orders: tagged('Admin · Orders').router(adminOrders),
    analytics: tagged('Admin · Analytics').router(adminAnalytics),
    discounts: tagged('Admin · Discounts').router(pricingModule.router.discounts),
    themes: tagged('Admin · Themes').router(themeModule.router),
    menus: tagged('Admin · Navigation').router(adminMenus),
    pages: tagged('Admin · Pages').router(adminPages),
    files: tagged('Admin · Files').router(filesModule.router.files),
    channels: tagged('Admin · Channels').router(adminChannels),
    domains: tagged('Admin · Domains').router(adminDomains),
    storefrontKeys: tagged('Admin · Storefront keys').router(adminStorefrontKeys),
    staff: tagged('Admin · Staff').router(adminStaff),
    platform: tagged('Admin · Platform').router(adminPlatform),
    storage: tagged('Admin · Storage').router(filesModule.router.storage),
    email: tagged('Admin · Email').router(adminEmail),
    notifications: tagged('Admin · Email').router(adminNotifications),
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
    webhooks: tagged('Admin · Webhooks').router(adminWebhooks),
    apiTokens: tagged('Admin · API tokens').router(adminApiTokens),
    apps: tagged('Admin · Apps').router(adminApps),
    appRegistry: tagged('Admin · App registry').router(adminAppRegistry),
    appData: tagged('Admin · App data').router(adminAppData),
    marketplace: tagged('Admin · Marketplace').router(adminMarketplace),
  },
}

export type Router = typeof router

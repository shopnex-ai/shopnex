import { os } from '@orpc/server'
import { pub, type Context } from './orpc'
import { apiTokens as adminApiTokens } from './routers/admin/api-tokens'
import { analytics as adminAnalytics } from './routers/admin/analytics'
import {
  appData as adminAppData,
  appRegistry as adminAppRegistry,
  apps as adminApps,
  marketplaceConnection as adminMarketplace,
} from './routers/admin/apps'
import {
  paymentMethods as adminPaymentMethods,
  shippingRates as adminShippingRates,
  taxRates as adminTaxRates,
} from './routers/admin/checkout-settings'
import { collections as adminCollections } from './routers/admin/collections'
import { customers as adminCustomers } from './routers/admin/customers'
import { discounts as adminDiscounts } from './routers/admin/discounts'
import { email as adminEmail } from './routers/admin/email'
import { files as adminFiles } from './routers/admin/files'
import { menus as adminMenus } from './routers/admin/menus'
import { notifications as adminNotifications } from './routers/admin/notifications'
import { pages as adminPages } from './routers/admin/pages'
import {
  paymentApps as adminPaymentApps,
  paymentSessions as adminPaymentSessions,
  paymentsAppApi as adminPaymentsApp,
} from './routers/admin/payments'
import { orders as adminOrders } from './routers/admin/orders'
import { products as adminProducts } from './routers/admin/products'
import { shop as adminShop } from './routers/admin/shop'
import { staff as adminStaff } from './routers/admin/staff'
import { storage as adminStorage } from './routers/admin/storage'
import { storefrontKeys as adminStorefrontKeys } from './routers/admin/storefront-keys'
import { themes as adminThemes } from './routers/admin/themes'
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
    customers: tagged('Admin · Customers').router(adminCustomers),
    orders: tagged('Admin · Orders').router(adminOrders),
    analytics: tagged('Admin · Analytics').router(adminAnalytics),
    discounts: tagged('Admin · Discounts').router(adminDiscounts),
    themes: tagged('Admin · Themes').router(adminThemes),
    menus: tagged('Admin · Navigation').router(adminMenus),
    pages: tagged('Admin · Pages').router(adminPages),
    files: tagged('Admin · Files').router(adminFiles),
    storefrontKeys: tagged('Admin · Storefront keys').router(adminStorefrontKeys),
    staff: tagged('Admin · Staff').router(adminStaff),
    storage: tagged('Admin · Storage').router(adminStorage),
    email: tagged('Admin · Email').router(adminEmail),
    notifications: tagged('Admin · Email').router(adminNotifications),
    shippingRates: tagged('Admin · Shipping').router(adminShippingRates),
    paymentMethods: tagged('Admin · Payments').router(adminPaymentMethods),
    paymentApps: tagged('Admin · Payments').router(adminPaymentApps),
    paymentsApp: tagged('Admin · Payments apps').router(adminPaymentsApp),
    paymentSessions: tagged('Admin · Payments apps').router(adminPaymentSessions),
    taxRates: tagged('Admin · Taxes').router(adminTaxRates),
    webhooks: tagged('Admin · Webhooks').router(adminWebhooks),
    apiTokens: tagged('Admin · API tokens').router(adminApiTokens),
    apps: tagged('Admin · Apps').router(adminApps),
    appRegistry: tagged('Admin · App registry').router(adminAppRegistry),
    appData: tagged('Admin · App data').router(adminAppData),
    marketplace: tagged('Admin · Marketplace').router(adminMarketplace),
  },
}

export type Router = typeof router

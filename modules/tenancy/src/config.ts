export type TenancyMode = 'single' | 'multi'

// single: one shop (created automatically), every user belongs to it.
// multi:  shops are resolved by storefront host / the admin's active shop.
export const TENANCY_MODE: TenancyMode = process.env.TENANCY_MODE === 'multi' ? 'multi' : 'single'

export const isMultiTenant = TENANCY_MODE === 'multi'

// Fixed id so the migration and runtime agree on the default shop
export const DEFAULT_SHOP_ID = 'default'

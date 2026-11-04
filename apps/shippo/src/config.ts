// What the merchant set up, per shop: where parcels ship from and what a cart weighs. The Shippo token is a secret
// in shop.data (encrypted); the rest is plain JSON.
import type { ShopContext } from '@shopnex/app'

export type Origin = {
  name: string
  street1: string
  city: string
  state: string
  zip: string
  country: string
}

/** What a cart weighs and measures: ShopNex sends no weights, so the merchant gives defaults */
export type Parcel = { itemWeightOz: number; lengthIn: number; widthIn: number; heightIn: number }

export type Config = { origin: Origin | null; parcel: Parcel }

export const DEFAULT_PARCEL: Parcel = { itemWeightOz: 8, lengthIn: 10, widthIn: 8, heightIn: 4 }

export async function loadConfig(shop: ShopContext): Promise<Config> {
  const saved = (await shop.data.get<Partial<Config>>('config')) ?? {}
  return { origin: saved.origin ?? null, parcel: { ...DEFAULT_PARCEL, ...saved.parcel } }
}

export const saveConfig = (shop: ShopContext, config: Config) => shop.data.set('config', config)
export const getToken = (shop: ShopContext) => shop.data.getSecret('shippo_token')
export const setToken = (shop: ShopContext, token: string) => shop.data.setSecret('shippo_token', token)

/** Ready for checkout: a token, and an address to ship from */
export const isReady = (config: Config, hasToken: boolean) => hasToken && config.origin !== null

// The shop's CJ connection: the API key is stored encrypted in app data, the tokens CJ issues from it are cached
// there too (they last 180 days; CJ returns the same ones for 24 hours, so we reuse rather than ask again).
import { cjSdk, getAccessToken, refreshAccessToken } from '@shopnex/cj-sdk'
import type { ShopContext } from '@shopnex/app'

type Tokens = {
  accessToken: string
  refreshToken: string
  accessTokenExpiryDate: string
  refreshTokenExpiryDate: string
}

export type CjSettings = {
  /** Percent added to CJ's price for the shop's price */
  markupPercent: number
  /** Pay the CJ order from the CJ balance right away; otherwise it waits for the merchant in CJ */
  autoPay: boolean
}

export const DEFAULT_SETTINGS: CjSettings = { markupPercent: 100, autoPay: false }

const DAY = 24 * 3600_000
const fresh = (date: string, days = 1) => new Date(date).getTime() - Date.now() > days * DAY

export const settingsOf = async (shop: ShopContext) => ({
  ...DEFAULT_SETTINGS,
  ...(await shop.data.get<Partial<CjSettings>>('settings')),
})

export async function connect(shop: ShopContext, apiKey: string) {
  const tokens = await getAccessToken(apiKey)
  await shop.data.setSecret('cj_api_key', apiKey)
  await shop.data.set('cj_tokens', tokens)
}

export const isConnected = async (shop: ShopContext) => Boolean(await shop.data.get('cj_tokens'))

async function accessToken(shop: ShopContext) {
  const tokens = await shop.data.get<Tokens>('cj_tokens')
  if (!tokens) throw new Error('CJ is not connected for this shop')
  if (fresh(tokens.accessTokenExpiryDate)) return tokens.accessToken
  const next = fresh(tokens.refreshTokenExpiryDate)
    ? await refreshAccessToken(tokens.refreshToken)
    : await getAccessToken((await shop.data.getSecret('cj_api_key')) ?? '')
  await shop.data.set('cj_tokens', next)
  return next.accessToken
}

/** The CJ SDK bound to this shop's token */
export async function cjFor(shop: ShopContext) {
  const token = await accessToken(shop)
  return { token, cj: cjSdk({ accessToken: token }) }
}

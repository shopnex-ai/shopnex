// What the app guides assume is already in scope: an app server with its Shopnex handle, an installed `shop`, and the guide's own helper functions (stubbed: the guides leave them to you).
import { Hono } from 'hono'
import { createShopnexApp, type ShopContext } from '@shopnex/app'

declare const APP_URL: string
const shopnex = createShopnexApp()
const app = new Hono()
// The `shop` an `onInstalled` handler receives
declare const shop: ShopContext
declare function writeDescription(apiKey: string | null | undefined, product: unknown, input: unknown): Promise<string>
declare function writeSeo(apiKey: string | null | undefined, product: unknown, input: unknown): Promise<object>

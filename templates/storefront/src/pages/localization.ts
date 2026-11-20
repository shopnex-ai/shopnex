import type { APIRoute } from 'astro'
import { localPath, rememberCountry } from '../core/localization'
import { shopnex } from '../core/shopnex'

// POST only (the country selector's form); Astro checks the form's origin. Remembers the country if the shop sells to it.
export const POST: APIRoute = async ({ request, cookies, url, redirect }) => {
  const form = await request.formData().catch(() => null)
  const country = String(form?.get('country') ?? '').toUpperCase()
  const shop = await shopnex.shop.get().catch(() => null)
  if (shop?.shipToCountries.includes(country)) rememberCountry(cookies, url, country)
  return redirect(localPath(form?.get('return_to')))
}

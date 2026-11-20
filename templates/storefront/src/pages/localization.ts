import type { APIRoute } from 'astro'
import { localPath, rememberCountry, rememberLanguage } from '../core/localization'
import { shopnex } from '../core/shopnex'

// POST only (the country and language selectors' forms); Astro checks the form's origin. Remembers a country the shop sells to
// (`country`) and a language the shop publishes (`language_code`); anything else is ignored.
export const POST: APIRoute = async ({ request, cookies, url, redirect }) => {
  const form = await request.formData().catch(() => null)
  const country = String(form?.get('country') ?? '').toUpperCase()
  const language = String(form?.get('language_code') ?? '')
  const shop = await shopnex.shop.get().catch(() => null)
  if (shop?.shipToCountries.includes(country)) rememberCountry(cookies, url, country)
  if (language && [shop?.languageCode, ...(shop?.languages ?? [])].includes(language)) {
    rememberLanguage(cookies, url, language)
  }
  return redirect(localPath(form?.get('return_to')))
}

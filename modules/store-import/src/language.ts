import type { Fetcher } from './fetcher'

/**
 * The language the store writes in, from its home page's `<html lang>` ("fr-FR", "pt_BR" → "fr-FR", "pt-BR"). Null when
 * the page says none or says something that is not a language tag: the shop then keeps its own language.
 */
export async function detectLanguage(origin: string, fetcher: Fetcher): Promise<string | null> {
  try {
    const html = await fetcher.text(`${origin}/`, 'text/html')
    const raw = html
      .match(/<html[^>]*\slang=["']([^"']+)["']/i)?.[1]
      ?.trim()
      .replace(/_/g, '-')
    if (!raw || raw.toLowerCase() === 'x-default') return null
    return Intl.getCanonicalLocales(raw)[0] ?? null
  } catch {
    return null
  }
}

// Which of a store's pages become ShopNex pages. Deterministic: the same pages in any order give the same result.
//
// Each role below (about, shipping, returns...) takes at most one page. A page can fill a role three ways, best first:
//   0. its handle is one of the role's known handles ("shipping-policy", "datenschutz", "politica-de-privacidad")
//   1. its handle holds a role word and is short (at most 4 words)
//   2. its title holds a role word and is short (at most 5 words)
// Within a tier the shortest handle wins, then the alphabetically first one. Nothing depends on the order the store lists
// its pages in, and a page belongs to one role only: the one it fits best (lowest tier, then the earlier role).
export type StorePage = { title: string; handle: string; html: string }

type Role = { id: string; handles: string[]; words: RegExp }

// English, German, French, Spanish. Handles are lower-case, accents folded, no trailing "-1" counter.
export const ROLES: Role[] = [
  {
    id: 'about',
    handles: [
      'about',
      'about-us',
      'our-story',
      'ueber-uns',
      'uber-uns',
      'a-propos',
      'qui-sommes-nous',
      'sobre-nosotros',
      'quienes-somos',
      'nosotros',
    ],
    // no bare "uber"/"ueber" here: "uber-eats" is not an About page; "ueber-uns" is matched by its handle above
    words: /\b(about|propos|sobre|quienes|nosotros|story)\b/,
  },
  {
    id: 'contact',
    handles: ['contact', 'contact-us', 'kontakt', 'contacto', 'contactez-nous', 'nous-contacter'],
    words: /\b(contact|kontakt|contacto|contactez)\b/,
  },
  {
    id: 'faq',
    handles: [
      'faq',
      'faqs',
      'frequently-asked-questions',
      'haeufig-gestellte-fragen',
      'preguntas-frecuentes',
      'questions-frequentes',
    ],
    words: /\b(faqs?|haeufig|frequently|preguntas|questions)\b/,
  },
  {
    id: 'shipping',
    handles: [
      'shipping',
      'shipping-policy',
      'shipping-info',
      'shipping-information',
      'delivery',
      'delivery-information',
      'versand',
      'versandinformationen',
      'lieferung',
      'livraison',
      'envios',
      'condiciones-de-envio',
    ],
    words: /\b(shipping|delivery|versand|lieferung|livraison|envios?)\b/,
  },
  {
    id: 'returns',
    handles: [
      'returns',
      'return-policy',
      'refund-policy',
      'returns-exchanges',
      'returns-and-exchanges',
      'rueckgabe',
      'widerrufsbelehrung',
      'widerruf',
      'retours',
      'devoluciones',
      'cambios-y-devoluciones',
    ],
    words:
      /\b(returns?|refunds?|rueckgabe|widerruf\w*|umtausch|retours?|remboursement|devoluciones|devolucion|cambios)\b/,
  },
  {
    id: 'size',
    handles: [
      'size-guide',
      'size-chart',
      'sizing',
      'groessentabelle',
      'groessentabellen',
      'guide-des-tailles',
      'guia-de-tallas',
    ],
    words: /\b(size|sizing|groesse|groessentabellen?|taille|tallas?|tallaje)\b/,
  },
  {
    id: 'privacy',
    handles: [
      'privacy',
      'privacy-policy',
      'datenschutz',
      'datenschutzerklaerung',
      'politique-de-confidentialite',
      'politica-de-privacidad',
      'privacidad',
    ],
    words: /\b(privacy|datenschutz\w*|confidentialite|privacidad)\b/,
  },
  {
    id: 'terms',
    handles: [
      'terms',
      'terms-of-service',
      'terms-of-use',
      'terms-and-conditions',
      'agb',
      'agbs',
      'allgemeine-geschaeftsbedingungen',
      'cgv',
      'conditions-generales-de-vente',
      'condiciones-de-uso',
      'condiciones-generales',
    ],
    words: /\b(terms|agbs?|cgv|bedingungen|geschaeftsbedingungen|conditions|condiciones)\b/,
  },
  {
    id: 'imprint',
    handles: ['impressum', 'imprint', 'mentions-legales', 'aviso-legal', 'legal-notice'],
    words: /\b(impressum|imprint|mentions|aviso)\b/,
  },
]

// Not the shop's own page for that role: old copies, test pages, wholesale or job terms, promotions, prize draws, a theme's
// own fragments "(Products Modal) Returns", discount-code entry pages.
const JUNK =
  /\b(old|test|draft|copy|backup|v\d|bold|b2b|wholesale|applicant|app|jobs?|prize|draw|sweepstakes?|giveaway|gewinnspiel|teilnahmebedingungen|discount|promo|rabatt|sale|club|ticket|modal|campaign)\b|^\(|\bpercent\b|%/

/** Lower case, accents and umlauts folded (ü → ue, é → e), only letters, digits and hyphens; a trailing "-1" counter dropped */
export function slug(text: string) {
  return text
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-\d+$/, '')
}

function tier(role: Role, page: StorePage): number | null {
  const handle = slug(page.handle)
  if (role.handles.includes(handle)) return 0
  const handleWords = handle.split('-').filter(Boolean)
  if (handleWords.length <= 4 && role.words.test(handleWords.join(' '))) return 1
  const titleWords = slug(page.title).split('-').filter(Boolean)
  if (titleWords.length <= 5 && role.words.test(titleWords.join(' '))) return 2
  return null
}

/** The usual shop pages in role order, one per role, each with a real body (pages built from a theme template come back empty) */
export function usualPages(pages: StorePage[]): StorePage[] {
  const usable = pages.filter(
    (p) => p.html.trim().length >= 200 && !JUNK.test(`${slug(p.handle).replace(/-/g, ' ')} ${p.title.toLowerCase()}`),
  )
  // Each page belongs to one role only: the role it fits best (lowest tier, then the earlier role). "International
  // shipping conditions" is a shipping page, not also the terms page.
  const owned = new Map<string, { page: StorePage; tier: number }[]>()
  for (const page of usable) {
    let best: { role: Role; tier: number } | null = null
    for (const role of ROLES) {
      const t = tier(role, page)
      if (t !== null && (!best || t < best.tier)) best = { role, tier: t }
    }
    if (best) owned.set(best.role.id, [...(owned.get(best.role.id) ?? []), { page, tier: best.tier }])
  }
  const chosen: StorePage[] = []
  for (const role of ROLES) {
    const best = (owned.get(role.id) ?? []).sort(
      (a, b) =>
        a.tier - b.tier || a.page.handle.length - b.page.handle.length || (a.page.handle < b.page.handle ? -1 : 1),
    )[0]
    if (best) chosen.push(best.page)
  }
  return chosen
}

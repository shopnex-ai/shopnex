import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { slug, usualPages, type StorePage } from '../src/pages'

const body = 'x'.repeat(300)
const page = (handle: string, title: string, html = body): StorePage => ({ handle, title, html })
const handles = (pages: StorePage[]) => usualPages(pages).map((p) => p.handle)

// Pages as real stores list them: policies mixed with campaign, promo and theme-fragment pages
const GERMAN = [
  page('b2b_datenschutzerklarung-mymuesli', 'B2B_Datenschutzerklärung mymuesli'),
  page('abo-bedingungen', 'Abo-Bedingungen'),
  page('widerrufsbelehrung', 'Widerrufsbelehrung'),
  page('datenschutz', 'Datenschutz'),
  page('teilnahmebedingungen-dfb', 'Teilnahmebedingungen mymuesli X DFB-Gewinnspiel 2026'),
  page('goldenes-ticket', 'Teilnahmebedingungen Goldenes Ticket Adventskalender 2026'),
  page('agb', 'Allgemeine Geschäftsbedingungen'),
  page('kontakt', 'Kontakt'),
  page('abo-kuendigen', 'Abo Kündigung', ''),
]
const SPANISH = [
  page('condiciones-de-envio-1', 'Condiciones de envío'),
  page('condiciones-de-envio-internacional', 'Condiciones de envío internacional'),
  page('como-se-realiza-una-devolucion', '¿Cómo se realiza una devolución?'),
  page('beachwear-x-talla', 'BEACHWEAR X TALLA'),
  page('contacto', 'Contacto'),
]
const ENGLISH = [
  page('about-us', 'About Us'),
  page('faqs-about-the-app', "FAQ's about the app"),
  page('privacy-policy', 'Gymshark Privacy Notice'),
  page('blackout-sale-terms', 'Blackout Sale Terms & Conditions'),
  page('prize-draw-terms', 'Gift Card Prize Draw Terms and Conditions'),
  page('domestic-shipping', '(Products Modal) Domestic Shipping'),
  page('faq', 'FAQ'),
  page('faq-old', 'FAQ (old)'),
  page('terms-of-service', 'Terms of Service'),
  page('shipping-policy', 'Shipping policy'),
]

function shuffled<T>(items: T[], seed: number) {
  const out = [...items]
  let state = seed
  for (let i = out.length - 1; i > 0; i--) {
    state = (state * 1664525 + 1013904223) % 4294967296
    const j = state % (i + 1)
    ;[out[i], out[j]] = [out[j]!, out[i]!]
  }
  return out
}

describe('usualPages', () => {
  it('gives the same pages for any order of the same input', () => {
    for (const set of [GERMAN, SPANISH, ENGLISH]) {
      const expected = handles(set)
      for (let seed = 1; seed <= 60; seed++) assert.deepEqual(handles(shuffled(set, seed)), expected)
    }
  })

  it('takes one page per role, in role order', () => {
    assert.deepEqual(handles(ENGLISH), ['about-us', 'faq', 'shipping-policy', 'privacy-policy', 'terms-of-service'])
  })

  it('finds the usual pages of a German store, not its promotions or B2B terms', () => {
    assert.deepEqual(handles(GERMAN), ['kontakt', 'widerrufsbelehrung', 'datenschutz', 'agb'])
  })

  it('finds the usual pages of a Spanish store', () => {
    assert.deepEqual(handles(SPANISH), [
      'contacto',
      'condiciones-de-envio-1',
      'como-se-realiza-una-devolucion',
      'beachwear-x-talla',
    ])
  })

  it('prefers a known handle, then the shortest handle, then the alphabetical one', () => {
    assert.deepEqual(handles([page('our-shipping-and-delivery', 'Shipping'), page('shipping', 'Anything')]), [
      'shipping',
    ])
    assert.deepEqual(handles([page('b-returns-info', 'Returns'), page('a-returns-info', 'Returns')]), [
      'a-returns-info',
    ])
  })

  it('does not take "uber" as German for about when it is a company name', () => {
    assert.deepEqual(handles([page('allbirds-uber-eats-press-release', 'Allbirds Uber Eats press release')]), [])
    assert.deepEqual(handles([page('uber-uns', 'Über uns')]), ['uber-uns'])
  })

  it('skips pages with no real body', () => {
    assert.deepEqual(handles([page('about', 'About', '<p>hi</p>')]), [])
  })

  it('does not use one page for two roles', () => {
    assert.deepEqual(handles([page('shipping-and-returns', 'Shipping and returns')]), ['shipping-and-returns'])
  })
})

describe('slug', () => {
  it('folds umlauts and accents and drops a trailing counter', () => {
    assert.equal(slug('Größentabellen'), 'groessentabellen')
    assert.equal(slug('Politique de confidentialité'), 'politique-de-confidentialite')
    assert.equal(slug('condiciones-de-envio-1'), 'condiciones-de-envio')
  })
})

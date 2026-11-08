// For the storefront language picker: "Français (fr)", each language named in itself so people find their own.
// Left-to-right languages only: themes aren't laid out for right-to-left yet. Any valid tag can still be set through
// the API.
const CODES = [
  'en',
  'fr',
  'de',
  'es',
  'it',
  'pt-BR',
  'pt-PT',
  'nl',
  'pl',
  'sv',
  'da',
  'nb',
  'fi',
  'cs',
  'ro',
  'hu',
  'el',
  'tr',
  'ru',
  'uk',
  'ja',
  'ko',
  'zh-Hans',
  'zh-Hant',
  'th',
  'vi',
  'id',
  'hi',
]

const label = (code: string) => {
  const name = new Intl.DisplayNames([code], { type: 'language' }).of(code) ?? code
  return `${name.charAt(0).toLocaleUpperCase(code)}${name.slice(1)} (${code})`
}

/** The options for the picker, with the shop's current language included even when it isn't in the list */
export function languageOptions(current?: string) {
  const codes = current && !CODES.includes(current) ? [current, ...CODES] : CODES
  return codes.map((code) => ({ value: code, label: label(code) }))
}

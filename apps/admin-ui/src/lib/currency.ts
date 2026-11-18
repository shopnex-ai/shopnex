import { CURRENCY_CODES } from '@shopnex/tenancy/contract'

const names = new Intl.DisplayNames(['en'], { type: 'currency' })

// For currency pickers: "USD — US Dollar"
export const currencyOptions = CURRENCY_CODES.map((code) => ({ value: code, label: `${code} — ${names.of(code)}` }))

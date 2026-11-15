// Formatting ShopNex money (dependency-free, for servers and theme scripts alike)
import type { Money } from './schemas'

const formats = new Map<string, Intl.NumberFormat>()

function format(currencyCode: string) {
  let f = formats.get(currencyCode)
  if (!f) {
    f = new Intl.NumberFormat('en', { style: 'currency', currency: currencyCode })
    formats.set(currencyCode, f)
  }
  return f
}

/** "$19.99" from ShopNex money (integer minor units: cents for USD, yen for JPY) */
export function formatMoney(money: Money) {
  const f = format(money.currencyCode)
  const digits = f.resolvedOptions().maximumFractionDigits ?? 2
  return f.format(money.amountMinor / 10 ** digits)
}

/** "19.99": the amount in major units with the currency's own number of decimals, no symbol or grouping */
export function moneyAmount(money: Money) {
  const digits = format(money.currencyCode).resolvedOptions().maximumFractionDigits ?? 2
  return (money.amountMinor / 10 ** digits).toFixed(digits)
}

/** How many digits follow the decimal point in `currencyCode`: 0 for JPY, 2 for USD, 3 for BHD */
export function currencyDigits(currencyCode: string) {
  return format(currencyCode).resolvedOptions().maximumFractionDigits ?? 2
}

/** Text typed in a price field ("19.99", "1,000") → integer minor units, null when empty, NaN for junk or too many decimals */
export function parseMoney(text: string, currencyCode: string): number | null {
  const trimmed = text.trim().replace(/,/g, '')
  if (trimmed === '') return null
  const digits = currencyDigits(currencyCode)
  const pattern = digits === 0 ? /^-?\d+$/ : new RegExp(`^-?\\d*(\\.\\d{0,${digits}})?$`)
  if (!pattern.test(trimmed) || !/\d/.test(trimmed)) return Number.NaN
  return Math.round(Number(trimmed) * 10 ** digits)
}

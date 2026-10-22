// Formatting Shopnex money (dependency-free, for servers and theme scripts alike)
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

/** "$19.99" from Shopnex money (integer minor units: cents for USD, yen for JPY) */
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

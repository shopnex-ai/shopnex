import { currencyDigits, formatMoney as format, moneyAmount, parseMoney } from '@shopnex/storefront-sdk/money'

// Amounts are whole numbers of the currency's smallest unit: cents for USD, yen for JPY, fils for BHD

export function formatMoney(minor: number, currency: string) {
  return format({ amountMinor: minor, currencyCode: currency })
}

/** "19.99" → 1999 (USD), "1000" → 1000 (JPY), "" → null, junk or too many decimals → NaN */
export function toMinor(text: string, currency: string): number | null {
  return parseMoney(text, currency)
}

/** Minor units as the text shown in a money input; null/undefined/non-finite → "" (never "NaN"). */
export function formatMinorInput(minor: number | null | undefined, currency: string) {
  return typeof minor === 'number' && Number.isFinite(minor)
    ? moneyAmount({ amountMinor: minor, currencyCode: currency })
    : ''
}

/** Minor units per main unit: 100 for USD, 1 for JPY, 1000 for BHD */
export const minorPerUnit = (currency: string) => 10 ** currencyDigits(currency)

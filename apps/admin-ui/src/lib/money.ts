export function formatMoney(cents: number, currency: string) {
  return new Intl.NumberFormat('en', { style: 'currency', currency }).format(cents / 100)
}

/** "19.99" → 1999, "" → null, junk → NaN */
export function toCents(text: string): number | null {
  const trimmed = text.trim().replace(/,/g, '')
  if (trimmed === '') return null
  if (!/^-?\d*(\.\d{0,2})?$/.test(trimmed) || !/\d/.test(trimmed)) return Number.NaN
  return Math.round(Number(trimmed) * 100)
}

/** Cents as the text shown in a money input; null/undefined/non-finite → "" (never "NaN"). */
export function formatCentsInput(cents: number | null | undefined) {
  return typeof cents === 'number' && Number.isFinite(cents) ? (cents / 100).toFixed(2) : ''
}

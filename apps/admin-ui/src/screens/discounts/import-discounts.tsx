import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { FormatSelect, ImportDialog, createEach, platformOptions } from '@/components/admin/import-dialog'
import { parseCsv, requireColumns } from '@/lib/csv'
import { client, orpc } from '@/lib/orpc'
import { formats, type DiscountRecord, type DiscountSource } from './discount-formats'

const sources = platformOptions<DiscountSource>(['shopify', 'woocommerce', 'shopnex'], 'Discounts CSV')

function parseDiscounts(text: string, source: DiscountSource): DiscountRecord[] {
  const rows = parseCsv(text, 'discount')
  const format = formats[source]
  requireColumns(rows, format.required, `${sources.find((option) => option.value === source)!.label} discounts`)
  const seen = new Set<string>()
  return rows.flatMap((row, index) => {
    const line = `Row ${index + 2}`
    const raw = format.read(row)
    if (!raw.code) return []
    if (/\s/.test(raw.code)) throw new Error(`${line}: code “${raw.code}” can't contain spaces.`)
    if (seen.has(raw.code.toLowerCase())) throw new Error(`${line}: code “${raw.code}” appears twice in this file.`)
    seen.add(raw.code.toLowerCase())
    if (raw.type !== 'percentage' && raw.type !== 'fixed_amount' && raw.type !== 'free_shipping')
      throw new Error(`${line}: unknown discount type.`)
    const { value, minSubtotalCents, usageLimit } = raw
    if (
      raw.type !== 'free_shipping' &&
      (!Number.isInteger(value) || value < 1 || (raw.type === 'percentage' && value > 100))
    ) {
      throw new Error(
        `${line}: the amount must be ${raw.type === 'percentage' ? 'a whole percentage from 1 to 100' : 'above 0'}.`,
      )
    }
    if (!Number.isInteger(minSubtotalCents) || minSubtotalCents < 0) throw new Error(`${line}: invalid minimum amount.`)
    if (usageLimit !== null && (!Number.isInteger(usageLimit) || usageLimit < 1))
      throw new Error(`${line}: invalid usage limit.`)
    const date = (value: string) => {
      if (!value) return null
      const parsed = new Date(value)
      if (!Number.isFinite(parsed.getTime())) throw new Error(`${line}: invalid date “${value}”.`)
      return parsed.toISOString()
    }
    const startsAt = date(raw.startsAt),
      endsAt = date(raw.endsAt)
    if (startsAt && endsAt && endsAt <= startsAt) throw new Error(`${line}: the end date must be after the start date.`)
    return [{ ...raw, type: raw.type, startsAt, endsAt }]
  })
}

export function ImportDiscountsDialog({ currency }: { currency: string }) {
  const queryClient = useQueryClient()
  const [source, setSource] = useState<DiscountSource>('shopify')
  const price = new Intl.NumberFormat(undefined, { style: 'currency', currency })

  return (
    <ImportDialog<DiscountRecord>
      title="Import discounts"
      description="Upload a discounts CSV from another platform. Codes that already exist are skipped, not changed."
      noun="discounts"
      resetKey={source}
      hint="One row per code, with its type, amount, and optional limits and dates."
      options={<FormatSelect label="Import from" value={source} options={sources} onChange={setSource} />}
      parse={(text) => parseDiscounts(text, source)}
      previewHeaders={['Code', 'Discount', 'Limit', 'Active']}
      previewRow={(d) => [
        d.code,
        d.type === 'percentage'
          ? `${d.value}%`
          : d.type === 'free_shipping'
            ? 'Free shipping'
            : price.format(d.value / 100),
        d.usageLimit ?? 'Unlimited',
        d.active ? 'Yes' : 'No',
      ]}
      run={(discounts, onProgress) =>
        createEach(
          discounts,
          (d) => d.code,
          (d) =>
            client.admin.discounts.create({
              ...d,
              startsAt: d.startsAt ? new Date(d.startsAt) : null,
              endsAt: d.endsAt ? new Date(d.endsAt) : null,
            }),
          onProgress,
        )
      }
      onFinished={() => queryClient.invalidateQueries({ queryKey: orpc.admin.discounts.key() })}
    />
  )
}

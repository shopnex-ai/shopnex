import { useState } from 'react'
import { ExportDialog, FormatSelect, platformOptions } from '@/components/admin/import-dialog'
import { client } from '@/lib/orpc'
import { discountsCsv, type DiscountSource } from './discount-formats'

const formats = platformOptions<DiscountSource>(['shopify', 'woocommerce', 'shopnex'], 'Discounts CSV')

export function ExportDiscountsDialog() {
  const [source, setSource] = useState<DiscountSource>('shopify')

  async function build() {
    const discounts = await client.admin.discounts.list()
    return { csv: discountsCsv(source, discounts), count: discounts.length }
  }

  return (
    <ExportDialog
      title="Export discounts"
      noun="discounts"
      filename={`shopnex-discounts-${source}`}
      build={build}
      description="Download your discount codes as a CSV formatted for another commerce platform."
    >
      <FormatSelect label="Export format" value={source} options={formats} onChange={setSource} />
    </ExportDialog>
  )
}

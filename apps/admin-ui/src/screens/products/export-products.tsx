import { useState } from 'react'
import { platformOptions, ExportDialog, FormatSelect } from '@/components/admin/import-dialog'
import { fetchAll } from '@/lib/csv'
import { client, type Outputs } from '@/lib/orpc'

type ExportSource = 'shopify' | 'woocommerce' | 'magento'
type Product = Outputs['admin']['products']['list']['items'][number]

const csvCell = (value: unknown) => {
  const text = value == null ? '' : String(value)
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}
const row = (values: unknown[]) => values.map(csvCell).join(',')
const money = (cents: number) => (cents / 100).toFixed(2)
const stock = (quantity: number | null) => (quantity == null ? '' : String(quantity))
const attributeCode = (name: string) =>
  name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')

function shopifyCsv(products: Product[]) {
  const headers = [
    'Handle',
    'Title',
    'Body (HTML)',
    'Vendor',
    'Type',
    'Tags',
    'Published',
    'Option1 Name',
    'Option1 Value',
    'Option2 Name',
    'Option2 Value',
    'Option3 Name',
    'Option3 Value',
    'Variant SKU',
    'Variant Price',
    'Variant Compare At Price',
    'Variant Inventory Qty',
    'Image Src',
    'Image Alt Text',
    'Status',
  ]
  const output = [row(headers)]
  for (const product of products) {
    product.variants.forEach((variant, index) => {
      const options = product.options.flatMap((option) => {
        const value = variant.options[option.name]
        return value ? [option.name, value] : []
      })
      const columns: unknown[] = [
        product.slug,
        index === 0 ? product.title : '',
        index === 0 ? (product.descriptionHtml ?? product.description ?? '') : '',
        index === 0 ? product.vendor : '',
        index === 0 ? product.productType : '',
        index === 0 ? product.tags.join(', ') : '',
        product.status === 'active' ? 'TRUE' : 'FALSE',
      ]
      for (let i = 0; i < 3; i++) columns.push(options[i * 2] ?? '', options[i * 2 + 1] ?? '')
      columns.push(
        variant.sku ?? '',
        money(variant.priceCents),
        variant.compareAtPriceCents == null ? '' : money(variant.compareAtPriceCents),
        stock(variant.inventoryQuantity),
      )
      const image = index === 0 ? product.images[0] : undefined
      columns.push(image?.url ?? '', image?.alt ?? '', product.status)
      output.push(row(columns))
    })
    for (const image of product.images.slice(1)) {
      output.push(
        row([
          product.slug,
          '',
          '',
          '',
          '',
          '',
          product.status === 'active' ? 'TRUE' : 'FALSE',
          '',
          '',
          '',
          '',
          '',
          '',
          '',
          '',
          '',
          '',
          image.url,
          image.alt ?? '',
          product.status,
        ]),
      )
    }
  }
  return output.join('\r\n')
}

function wooCommerceCsv(products: Product[]) {
  const headers = [
    'Type',
    'SKU',
    'Name',
    'Published',
    'Description',
    'Regular price',
    'Sale price',
    'Stock',
    'Images',
    'Tags',
    'Parent',
    ...Array.from({ length: 3 }, (_, i) => [`Attribute ${i + 1} name`, `Attribute ${i + 1} value(s)`]).flat(),
  ]
  const output = [row(headers)]
  for (const product of products) {
    const options = product.options
    if (options.length > 0) {
      const parentSku = `${product.slug}-parent`
      output.push(
        row([
          'variable',
          parentSku,
          product.title,
          product.status === 'active' ? '1' : '-1',
          product.descriptionHtml ?? product.description ?? '',
          '',
          '',
          '',
          product.images.map((image) => image.url).join(', '),
          product.tags.join(', '),
          '',
          ...options.flatMap((option) => [option.name, option.values.join(', ')]),
        ]),
      )
      for (const variant of product.variants) {
        output.push(
          row([
            'variation',
            variant.sku ?? '',
            '',
            product.status === 'active' ? '1' : '-1',
            '',
            variant.compareAtPriceCents == null ? money(variant.priceCents) : money(variant.compareAtPriceCents),
            variant.compareAtPriceCents == null ? '' : money(variant.priceCents),
            stock(variant.inventoryQuantity),
            variant.imageUrl ?? '',
            '',
            parentSku,
            ...options.flatMap((option) => [option.name, variant.options[option.name] ?? '']),
          ]),
        )
      }
    } else {
      const variant = product.variants[0]!
      output.push(
        row([
          'simple',
          variant.sku ?? '',
          product.title,
          product.status === 'active' ? '1' : '-1',
          product.descriptionHtml ?? product.description ?? '',
          variant.compareAtPriceCents == null ? money(variant.priceCents) : money(variant.compareAtPriceCents),
          variant.compareAtPriceCents == null ? '' : money(variant.priceCents),
          stock(variant.inventoryQuantity),
          product.images.map((image) => image.url).join(', '),
          product.tags.join(', '),
          '',
          ...options.flatMap((option) => [option.name, option.values.join(', ')]),
        ]),
      )
    }
  }
  return output.join('\r\n')
}

function magentoCsv(products: Product[]) {
  const headers = [
    'sku',
    'store_view_code',
    'attribute_set_code',
    'product_type',
    'product_online',
    'name',
    'price',
    'special_price',
    'qty',
    'is_in_stock',
    'visibility',
    'description',
    'short_description',
    'manufacturer',
    'image',
    'additional_images',
    'configurable_variation_labels',
    'configurable_variations',
  ]
  const output = [row(headers)]
  for (const product of products) {
    const variantSku = (variant: Product['variants'][number], index: number) =>
      variant.sku || `${product.slug}-${index + 1}`
    const configured = product.options.length > 0 && product.variants.length > 1
    if (configured) {
      const labels = product.options.map((option) => `${attributeCode(option.name)}=${option.name}`).join(',')
      const descriptors = product.variants
        .map(
          (variant, index) =>
            `sku=${variantSku(variant, index)},${product.options.map((option) => `${attributeCode(option.name)}=${variant.options[option.name] ?? ''}`).join(',')}`,
        )
        .join('|')
      output.push(
        row([
          product.slug,
          '',
          'Default',
          'configurable',
          product.status === 'active' ? 1 : 2,
          product.title,
          '',
          '',
          '',
          '',
          'Catalog, Search',
          product.descriptionHtml ?? product.description ?? '',
          '',
          product.vendor,
          product.images[0]?.url ?? '',
          product.images
            .slice(1)
            .map((image) => image.url)
            .join(','),
          labels,
          descriptors,
        ]),
      )
      product.variants.forEach((variant, index) =>
        output.push(
          row([
            variantSku(variant, index),
            '',
            'Default',
            'simple',
            product.status === 'active' ? 1 : 2,
            `${product.title} ${variant.title}`,
            money(variant.compareAtPriceCents ?? variant.priceCents),
            variant.compareAtPriceCents == null ? '' : money(variant.priceCents),
            stock(variant.inventoryQuantity),
            variant.inventoryQuantity == null || variant.inventoryQuantity > 0 ? 1 : 0,
            'Not Visible Individually',
            '',
            '',
            product.vendor,
            variant.imageUrl ?? '',
            '',
            '',
            '',
          ]),
        ),
      )
    } else {
      const variant = product.variants[0]!
      output.push(
        row([
          variant.sku || product.slug,
          '',
          'Default',
          'simple',
          product.status === 'active' ? 1 : 2,
          product.title,
          money(variant.compareAtPriceCents ?? variant.priceCents),
          variant.compareAtPriceCents == null ? '' : money(variant.priceCents),
          stock(variant.inventoryQuantity),
          variant.inventoryQuantity == null || variant.inventoryQuantity > 0 ? 1 : 0,
          'Catalog, Search',
          product.descriptionHtml ?? product.description ?? '',
          '',
          product.vendor,
          product.images[0]?.url ?? '',
          product.images
            .slice(1)
            .map((image) => image.url)
            .join(','),
          '',
          '',
        ]),
      )
    }
  }
  return output.join('\r\n')
}

const exporters: Record<ExportSource, (products: Product[]) => string> = {
  shopify: shopifyCsv,
  woocommerce: wooCommerceCsv,
  magento: magentoCsv,
}

const formats = platformOptions<ExportSource>(['shopify', 'woocommerce', 'magento'], 'Products CSV')

export function ExportProductsDialog() {
  const [source, setSource] = useState<ExportSource>('shopify')

  async function build() {
    const products = await fetchAll((page) => client.admin.products.list(page))
    return { csv: exporters[source](products), count: products.length }
  }

  return (
    <ExportDialog
      title="Export products"
      noun="products"
      filename={`shopnex-products-${source}`}
      build={build}
      description="Download your Shopnex catalog as a CSV formatted for another commerce platform."
    >
      <FormatSelect label="Export format" value={source} options={formats} onChange={setSource} />
    </ExportDialog>
  )
}

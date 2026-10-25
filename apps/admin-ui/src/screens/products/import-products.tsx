import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { FormatSelect, ImportDialog, platformOptions, createEach } from '@/components/admin/import-dialog'
import { parseCsv, type CsvRow } from '@/lib/csv'
import { client, orpc } from '@/lib/orpc'


type ImportSource = 'shopify' | 'woocommerce' | 'magento'
type ImportProduct = {
  title: string
  status: 'active' | 'draft'
  descriptionHtml: string | null
  vendor: string
  productType: string
  tags: string[]
  images: { url: string; alt: string | null }[]
  options?: { name: string; values: string[] }[]
  variants: {
    sku: string | null
    priceCents: number
    compareAtPriceCents: number | null
    inventoryQuantity: number | null
    imageUrl: string | null
    options?: Record<string, string>
  }[]
}


function money(value: string, row: number) {
  const amount = Number(value)
  if (!Number.isFinite(amount) || amount < 0) throw new Error(`Row ${row}: invalid Variant Price.`)
  return Math.round(amount * 100)
}

function toProducts(rows: CsvRow[]): ImportProduct[] {
  const groups = new Map<string, {
    product: ImportProduct
    optionValues: Map<string, Set<string>>
    optionNames: Map<number, string>
    variantSlots: string[][]
    variantTitles: string[]
  }>()
  rows.forEach((row, index) => {
    const title = row.Title || (row.Handle ? '' : '')
    if (!title && !row.Handle) return
    const key = row.Handle || title
    let group = groups.get(key)
    if (!group) {
      if (!title) throw new Error(`Row ${index + 2}: product title is missing.`)
      const isPublished = row.Status ? row.Status.toLowerCase() === 'active' : (row.Published ?? '').toLowerCase() === 'true'
      group = { product: {
        title, status: isPublished ? 'active' : 'draft', descriptionHtml: row['Body (HTML)'] || null,
        vendor: row.Vendor ?? '', productType: row.Type ?? '',
        tags: (row.Tags ?? '').split(',').map((tag) => tag.trim()).filter(Boolean), images: [], variants: [],
      }, optionValues: new Map(), optionNames: new Map(), variantSlots: [], variantTitles: [] }
      groups.set(key, group)
    }
    const current = groups.get(key)!
    const product = current.product
    const options: Record<string, string> = {}
    const slotValues: string[] = []
    for (let n = 1; n <= 3; n++) {
      const csvName = row[`Option${n} Name`]
      if (csvName) current.optionNames.set(n - 1, csvName)
      const name = csvName || current.optionNames.get(n - 1)
      const value = row[`Option${n} Value`]
      slotValues[n - 1] = value ?? ''
      if (name && value && name !== 'Title' && value !== 'Default Title') {
        options[name] = value
        const values = current.optionValues.get(name) ?? new Set<string>()
        values.add(value); current.optionValues.set(name, values)
      }
    }
    const variantPrice = row['Variant Price']
    if (variantPrice) {
      const compare = row['Variant Compare At Price']
      const inventory = row['Variant Inventory Qty']
      product.variants.push({
        sku: row['Variant SKU'] || null,
        priceCents: money(variantPrice, index + 2),
        compareAtPriceCents: compare ? money(compare, index + 2) : null,
        inventoryQuantity: inventory !== '' && Number.isFinite(Number(inventory)) ? Math.max(0, Number(inventory)) : null,
        imageUrl: null,
        ...(Object.keys(options).length > 0 && { options }),
      })
      current.variantSlots.push(slotValues)
      current.variantTitles.push(row['Variant Title'] ?? '')
    }
    const image = row['Image Src']
    if (image && !product.images.some((item) => item.url === image)) product.images.push({ url: image, alt: row['Image Alt Text'] || null })
  })
  return [...groups.values()].map(({ product, optionValues, optionNames, variantSlots, variantTitles }) => {
    if (!product.variants.length) throw new Error(`${product.title}: no priced variants were found.`)
    const options = [...optionNames.entries()]
      .sort(([left], [right]) => left - right)
      .map(([, name]) => ({ name, values: [...(optionValues.get(name) ?? [])] }))
      .filter((option) => option.name !== 'Title' && option.values.length > 0)
    product.variants = product.variants.map((variant, variantIndex) => {
      const picked: Record<string, string> = {}
      const titleValues = (variantTitles[variantIndex] || '').split(/\s*\/\s*/)
      options.forEach((option, optionIndex) => {
        let value = variantSlots[variantIndex]?.[optionIndex] ?? ''
        if (!value && titleValues.length === options.length) {
          value = option.values.find((candidate) => candidate.toLowerCase() === titleValues[optionIndex]?.toLowerCase()) ?? ''
        }
        if (!value && option.values.length === 1) value = option.values[0]!
        if (!value) {
          throw new Error(`${product.title}: variant ${variantIndex + 1} is missing an option value for “${option.name}”. Check its Option value columns in the CSV.`)
        }
        picked[option.name] = value
      })
      return { ...variant, ...(options.length ? { options: picked } : {}) }
    })
    if (options.length) product.options = options
    return product
  })
}

function toWooCommerceProducts(rows: CsvRow[]): ImportProduct[] {
  const products: ImportProduct[] = []
  const byReference = new Map<string, ImportProduct>()
  const variableRows = new Map<ImportProduct, CsvRow>()
  const variations: CsvRow[] = []
  const status = (value: string) => value === '1' || value.toLowerCase() === 'publish' ? 'active' : 'draft'
  const splitList = (value: string) => value.split(/(?<!\\),/).map((item) => item.replace(/\\,/g, ',').trim()).filter(Boolean)
  const attrs = (row: CsvRow) => {
    const found: Record<string, string> = {}
    for (let n = 1; n <= 10; n++) {
      const name = row[`Attribute ${n} name`]
      const value = row[`Attribute ${n} value(s)`]
      if (name && value) found[name] = value
    }
    return found
  }
  const addImages = (product: ImportProduct, value: string) => {
    for (const url of splitList(value)) {
      if (/^https?:\/\//i.test(url) && !product.images.some((image) => image.url === url)) product.images.push({ url, alt: null })
    }
  }
  const prices = (row: CsvRow, index: number) => {
    const regular = row['Regular price'] || row.Price
    if (!regular) throw new Error(`Row ${index}: product has no regular price.`)
    const sale = row['Sale price']
    return { priceCents: money(sale || regular, index), compareAtPriceCents: sale ? money(regular, index) : null }
  }

  rows.forEach((row, index) => {
    const type = (row.Type || 'simple').toLowerCase()
    if (type === 'variation') { variations.push(row); return }
    if (type !== 'simple' && type !== 'variable') return
    if (!row.Name) throw new Error(`Row ${index + 2}: product name is missing.`)
    const attributeMap = attrs(row)
    const options = Object.entries(attributeMap).map(([name, value]) => ({ name, values: splitList(value) }))
    const product: ImportProduct = {
      title: row.Name,
      status: status(row.Published ?? ''),
      descriptionHtml: row.Description || row['Short description'] || null,
      vendor: '', productType: '', tags: splitList(row.Tags ?? ''), images: [], variants: [],
      ...(options.length ? { options } : {}),
    }
    if (type === 'simple') {
      const price = prices(row, index + 2)
      product.variants.push({
        sku: row.SKU || null,
        ...price,
        inventoryQuantity: row['Stock'] !== '' && Number.isFinite(Number(row.Stock)) ? Math.max(0, Number(row.Stock)) : null,
        imageUrl: null,
      })
    } else variableRows.set(product, row)
    addImages(product, row.Images ?? '')
    products.push(product)
    if (row.SKU) byReference.set(row.SKU, product)
    if (row.ID) byReference.set(`id:${row.ID}`, product)
  })

  for (const row of variations) {
    const parent = byReference.get(row.Parent ?? '')
    if (!parent) continue
    const parentRow = variableRows.get(parent)
    const parentAttributes = parentRow ? attrs(parentRow) : {}
    const variantOptions: Record<string, string> = {}
    for (const name of Object.keys(parentAttributes)) {
      const value = Object.entries(attrs(row)).find(([attribute]) => attribute === name)?.[1]
      if (value) variantOptions[name] = value
    }
    const rowIndex = rows.indexOf(row) + 2
    const price = prices(row, rowIndex)
    parent.variants.push({
      sku: row.SKU || null,
      ...price,
      inventoryQuantity: row.Stock !== '' && Number.isFinite(Number(row.Stock)) ? Math.max(0, Number(row.Stock)) : null,
      imageUrl: null,
      ...(Object.keys(variantOptions).length ? { options: variantOptions } : {}),
    })
    addImages(parent, row.Images ?? '')
  }

  for (const [product] of variableRows) {
    if (!product.variants.length) throw new Error(`${product.title}: no variation rows with prices were found.`)
  }
  return products
}

function toMagentoProducts(rows: CsvRow[]): ImportProduct[] {
  const bySku = new Map(rows.filter((row) => row.sku).map((row) => [row.sku!, row]))
  const linkedSkus = new Set<string>()
  const products: ImportProduct[] = []
  const amount = (value: string, row: number) => {
    if (!value) throw new Error(`Row ${row}: product has no price.`)
    return money(value, row)
  }
  const isActive = (row: CsvRow) => (row.product_online ?? row.status ?? '1') === '1'
  const productFromRow = (row: CsvRow, index: number): ImportProduct => {
    const price = amount(row.price ?? '', index + 2)
    const special = row.special_price
    return {
      title: row.name || row.sku || `Product ${index + 1}`,
      status: isActive(row) ? 'active' : 'draft',
      descriptionHtml: row.description || row.short_description || null,
      vendor: row.manufacturer || '', productType: '', tags: [],
      images: row.image && /^https?:\/\//i.test(row.image) ? [{ url: row.image, alt: null }] : [],
      variants: [{
        sku: row.sku || null,
        priceCents: special ? amount(special, index + 2) : price,
        compareAtPriceCents: special ? price : null,
        inventoryQuantity: row.qty !== '' && Number.isFinite(Number(row.qty)) ? Math.max(0, Number(row.qty)) : null,
        imageUrl: null,
      }],
    }
  }
  const parsePairs = (text: string) => Object.fromEntries(text.split(',').map((part) => {
    const separator = part.indexOf('=')
    return separator < 0 ? ['', ''] : [part.slice(0, separator).trim(), part.slice(separator + 1).trim()]
  }).filter(([key, value]) => key && value))
  for (const row of rows) {
    if ((row.product_type ?? row.type ?? '').toLowerCase() !== 'configurable') continue
    for (const descriptor of (row.configurable_variations ?? '').split('|')) {
      const sku = parsePairs(descriptor.trim()).sku
      if (sku) linkedSkus.add(sku)
    }
  }

  rows.forEach((row, index) => {
    const type = (row.product_type ?? row.type ?? 'simple').toLowerCase()
    if (type === 'configurable') {
      const descriptors = (row.configurable_variations ?? '').split('|').map((part) => parsePairs(part.trim())).filter((part) => part.sku)
      if (!descriptors.length) throw new Error(`${row.name || row.sku}: configurable_variations data is missing.`)
      const labels = parsePairs(row.configurable_variation_labels ?? '')
      const codes = [...new Set(descriptors.flatMap((variant) => Object.keys(variant).filter((key) => key !== 'sku' && key !== 'price' && key !== 'default' && key !== 'display' && key !== 'image')))]
      const options = codes.map((code) => ({
        name: labels[code] || code.replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase()),
        values: [...new Set(descriptors.map((variant) => variant[code]).filter((value): value is string => Boolean(value)))],
      }))
      const product: ImportProduct = {
        title: row.name || row.sku || `Product ${index + 1}`,
        status: isActive(row) ? 'active' : 'draft',
        descriptionHtml: row.description || row.short_description || null,
        vendor: row.manufacturer || '', productType: '', tags: [], images: [], options, variants: [],
      }
      if (row.image && /^https?:\/\//i.test(row.image)) product.images.push({ url: row.image, alt: null })
      for (const descriptor of descriptors) {
        const child = bySku.get(descriptor.sku!)
        const childIndex = child ? rows.indexOf(child) + 2 : index + 2
        const childPrice = child?.price || descriptor.price || row.price || ''
        const optionValues = Object.fromEntries(codes.map((code) => [labels[code] || code.replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase()), descriptor[code] || '']).filter(([, value]) => value))
        if (!childPrice) throw new Error(`${row.name || row.sku}: no price found for variant ${descriptor.sku}.`)
        const regular = amount(childPrice, childIndex)
        const special = child?.special_price
        product.variants.push({
          sku: descriptor.sku!,
          priceCents: special ? amount(special, childIndex) : regular,
          compareAtPriceCents: special ? regular : null,
          inventoryQuantity: child?.qty !== undefined && child.qty !== '' && Number.isFinite(Number(child.qty)) ? Math.max(0, Number(child.qty)) : null,
          imageUrl: null,
          ...(Object.keys(optionValues).length ? { options: optionValues } : {}),
        })
        linkedSkus.add(descriptor.sku!)
        if (child?.image && /^https?:\/\//i.test(child.image) && !product.images.some((image) => image.url === child.image)) product.images.push({ url: child.image, alt: null })
      }
      products.push(product)
    } else if (type === 'simple' && row.sku && !linkedSkus.has(row.sku)) {
      products.push(productFromRow(row, index))
    }
  })
  return products
}

function parseProducts(text: string, source: ImportSource) {
  const rows = parseCsv(text, 'product')
  const headers = Object.keys(rows[0] ?? {})
  if (source === 'shopify') {
    if (!headers.includes('Title') || !headers.includes('Variant Price')) {
      throw new Error('Use a Shopify product export CSV with Title and Variant Price columns.')
    }
    return toProducts(rows)
  }
  if (source === 'magento') {
    if (!headers.includes('sku') || !headers.includes('product_type') || !headers.includes('price')) {
      throw new Error('Use a Magento product export CSV with sku, product_type, and price columns.')
    }
    return toMagentoProducts(rows)
  }
  if (!headers.includes('Name') || !headers.includes('Regular price')) {
    throw new Error('Use a WooCommerce product export CSV with Name and Regular price columns.')
  }
  return toWooCommerceProducts(rows)
}

const sources = platformOptions<ImportSource>(['shopify', 'woocommerce', 'magento'], 'Products CSV')
const sourceNames = { shopify: 'Shopify', woocommerce: 'WooCommerce', magento: 'Magento / Adobe Commerce' }

export function ImportProductsDialog() {
  const queryClient = useQueryClient()
  const [source, setSource] = useState<ImportSource>('shopify')

  return <ImportDialog<ImportProduct>
    title="Import products"
    description="Bring products into Shopnex from a platform product export CSV. Existing products are not changed."
    noun="products"
    resetKey={source}
    hint={`Export products from ${sourceNames[source]} and upload the CSV. Names, variants, prices, stock and image links are imported.`}
    options={<FormatSelect label="Import from" value={source} options={sources} onChange={setSource} />}
    parse={(text) => parseProducts(text, source)}
    previewHeaders={['Product', 'Variants', 'Status']}
    previewRow={(product) => [product.title, product.variants.length, <span className="capitalize">{product.status}</span>]}
    run={(products, onProgress) => createEach(products, (p) => p.title, (p) => client.admin.products.create(p), onProgress)}
    onFinished={() => queryClient.invalidateQueries({ queryKey: orpc.admin.products.key() })}
  />
}

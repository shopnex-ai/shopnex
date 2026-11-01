import { create } from './products'

// A few products so a new shop's storefront isn't empty (demo / self-serve signup). Prices are in minor units.
const SAMPLES = [
  { title: 'Classic Tee', productType: 'Apparel', priceCents: 2500, tags: ['sample'] },
  { title: 'Canvas Tote Bag', productType: 'Accessories', priceCents: 1800, tags: ['sample'] },
  { title: 'Ceramic Mug', productType: 'Home', priceCents: 1400, tags: ['sample'] },
  {
    title: 'Hoodie',
    productType: 'Apparel',
    tags: ['sample'],
    options: [{ name: 'Size', values: ['S', 'M', 'L'] }],
    variants: ['S', 'M', 'L'].map((size) => ({ options: { Size: size }, priceCents: 5500 })),
  },
]

export async function seedSampleProducts(shopId: string) {
  for (const sample of SAMPLES) {
    await create(shopId, {
      ...sample,
      vendor: 'Sample',
      description: 'A sample product. Edit or delete it in Products.',
    })
  }
}

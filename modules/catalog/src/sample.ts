import { create } from './products'

// Picsum gives every seed a stable photo (same source as the demo seed script)
const image = (seed: string, alt: string) => [{ url: `https://picsum.photos/seed/${seed}/900/900`, alt }]

// A few products so a new shop's storefront isn't empty (demo / self-serve signup). Prices are in minor units.
const SAMPLES = [
  {
    title: 'Classic Tee',
    images: image('sample-classic-tee', 'Classic Tee'),
    productType: 'Apparel',
    priceCents: 2500,
    tags: ['sample'],
  },
  {
    title: 'Canvas Tote Bag',
    images: image('sample-canvas-tote-bag', 'Canvas Tote Bag'),
    productType: 'Accessories',
    priceCents: 1800,
    tags: ['sample'],
  },
  {
    title: 'Ceramic Mug',
    images: image('sample-ceramic-mug', 'Ceramic Mug'),
    productType: 'Home',
    priceCents: 1400,
    tags: ['sample'],
  },
  {
    title: 'Hoodie',
    images: image('sample-hoodie', 'Hoodie'),
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

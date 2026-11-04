import { create } from './products'

// Free-to-use photos from Burst by Shopify (https://burst.shopify.com/photos/<name>), cropped square by its CDN
const image = (name: string, alt: string) => [
  { url: `https://burst.shopifycdn.com/photos/${name}.jpg?width=900&height=900&crop=center`, alt },
]

// A few products so a new shop's storefront isn't empty (demo / self-serve signup). Prices are in minor units.
const SAMPLES = [
  {
    title: 'Classic Tee',
    images: image('tshirts', 'Classic Tee'),
    productType: 'Apparel',
    priceCents: 2500,
    tags: ['sample'],
  },
  {
    title: 'Leather Shoulder Bag',
    images: image('black-bag-over-the-shoulder', 'Leather Shoulder Bag'),
    productType: 'Accessories',
    priceCents: 8900,
    tags: ['sample'],
  },
  {
    title: 'Ceramic Cup',
    images: image('coffee-cup-on-table-top', 'Ceramic Cup'),
    productType: 'Home',
    priceCents: 1400,
    tags: ['sample'],
  },
  {
    title: 'Leather Jacket',
    images: image('close-up-leather-jacket-over-shoulders', 'Leather Jacket'),
    productType: 'Apparel',
    tags: ['sample'],
    options: [{ name: 'Size', values: ['S', 'M', 'L'] }],
    variants: ['S', 'M', 'L'].map((size) => ({ options: { Size: size }, priceCents: 12900 })),
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

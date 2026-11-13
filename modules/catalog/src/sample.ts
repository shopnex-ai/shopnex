import { count, create } from './products'

// Free-to-use photos from Burst by Shopify (https://burst.shopify.com/photos/<name>), cropped square by its CDN.
// Free for commercial use, no attribution required; the photos may not be sold as digital files.
//   tshirts                                 Matthew Henry      CC0
//   black-bag-over-the-shoulder             Shopify Partners   Burst license
//   coffee-cup-on-table-top                 Tomáš Hustoles     Burst license
//   close-up-leather-jacket-over-shoulders  Jeremy Marasigan   Burst license
const image = (name: string, alt: string) => [
  { url: `https://burst.shopifycdn.com/photos/${name}.jpg?width=900&height=900&crop=center`, alt },
]

// A few products to try the shop with, added on request from the empty Products page. Prices are in minor units.
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

// Only into an empty shop (so a double click or a second tab can't add them twice); returns how many were added
export async function seedSampleProducts(shopId: string) {
  if ((await count(shopId, {})) > 0) return 0
  for (const sample of SAMPLES) {
    await create(shopId, {
      ...sample,
      vendor: 'Sample',
      description: 'A sample product. Edit or delete it in Products.',
    })
  }
  return SAMPLES.length
}

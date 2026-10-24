// The demo catalog: 4 collections, 19 products. Every product is tagged "demo", which is how the sample
// orders know which products to use (so they work next to products you added yourself).
import { collectionService, productService, type ProductInput } from '@shopnex/catalog'
import { db, schema } from '@shopnex/db'
import { and, eq } from 'drizzle-orm'

// Picsum gives every seed a stable photo; the second image stands in for a detail shot
const image = (seed: string) => ({ url: `https://picsum.photos/seed/${seed}/900/900`, alt: seed.replaceAll('-', ' ') })
const images = (seed: string) => [image(seed), image(`${seed}-detail`)]

const sizes = ['S', 'M', 'L', 'XL']
const withSizes = (priceCents: number, compareAtPriceCents?: number): Pick<ProductInput, 'options' | 'variants'> => ({
  options: [{ name: 'Size', values: sizes }],
  variants: sizes.map((size) => ({
    options: { Size: size },
    priceCents,
    compareAtPriceCents,
    inventoryQuantity: 25,
  })),
})
const withColors = (priceCents: number, colors: string[]): Pick<ProductInput, 'options' | 'variants'> => ({
  options: [{ name: 'Color', values: colors }],
  variants: colors.map((color) => ({ options: { Color: color }, priceCents, inventoryQuantity: 30 })),
})
const simple = (priceCents: number) => ({ priceCents })

const catalog: { collection: string; description: string; products: ProductInput[] }[] = [
  {
    collection: 'Apparel',
    description: 'Everyday clothing in natural fabrics, cut to last.',
    products: [
      {
        title: 'Classic Cotton Tee',
        description: 'A soft, everyday t-shirt in heavyweight cotton.',
        vendor: 'Shopnex',
        productType: 'T-shirt',
        tags: ['basics', 'bestseller'],
        images: images('cotton-tee'),
        ...withSizes(2400),
      },
      {
        title: 'Everyday Hoodie',
        description: 'Brushed fleece hoodie with a relaxed fit.',
        vendor: 'Shopnex',
        productType: 'Hoodie',
        tags: ['basics', 'winter', 'bestseller'],
        images: images('everyday-hoodie'),
        ...withSizes(5800, 6800),
      },
      {
        title: 'Linen Overshirt',
        description: 'Lightweight linen layer for warm evenings.',
        vendor: 'Maison Lune',
        productType: 'Shirt',
        tags: ['summer'],
        images: images('linen-overshirt'),
        ...withSizes(6800),
      },
      {
        title: 'Relaxed Denim Jacket',
        description: 'Washed organic denim with a boxy, easy shape.',
        vendor: 'Northfield',
        productType: 'Jacket',
        tags: ['new'],
        images: images('denim-jacket'),
        ...withSizes(9400),
      },
      {
        title: 'Merino Crew Sweater',
        description: 'Fine-gauge merino that keeps its shape wash after wash.',
        vendor: 'Northfield',
        productType: 'Sweater',
        tags: ['winter'],
        images: images('merino-sweater'),
        ...withSizes(8400),
      },
    ],
  },
  {
    collection: 'Accessories',
    description: 'Small things you will use every day.',
    products: [
      {
        title: 'Canvas Tote Bag',
        description: 'Sturdy canvas tote with an inside pocket.',
        vendor: 'Shopnex',
        productType: 'Bag',
        tags: ['basics', 'bestseller'],
        images: images('canvas-tote'),
        ...simple(1800),
      },
      {
        title: 'Wool Beanie',
        description: 'Warm ribbed beanie in merino wool.',
        vendor: 'Northfield',
        productType: 'Hat',
        tags: ['winter'],
        images: images('wool-beanie'),
        ...withColors(2200, ['Charcoal', 'Oat', 'Forest']),
      },
      {
        title: 'Leather Card Holder',
        description: 'Slim vegetable-tanned leather card holder.',
        vendor: 'Maison Lune',
        productType: 'Wallet',
        tags: ['gift'],
        images: images('card-holder'),
        ...withColors(3200, ['Tan', 'Black']),
      },
      {
        title: 'Silk Scarf',
        description: 'Hand-rolled silk twill scarf with a printed border.',
        vendor: 'Maison Lune',
        productType: 'Scarf',
        tags: ['gift'],
        images: images('silk-scarf'),
        ...simple(4800),
      },
      {
        title: 'Minimal Field Watch',
        description: 'Brushed steel case, sapphire glass and a leather strap.',
        vendor: 'Northfield',
        productType: 'Watch',
        tags: ['gift', 'new'],
        images: images('field-watch'),
        ...simple(12900),
      },
      {
        title: 'Full-Grain Leather Belt',
        description: 'A single piece of full-grain leather with a solid brass buckle.',
        vendor: 'Maison Lune',
        productType: 'Belt',
        images: images('leather-belt'),
        ...withSizes(3900),
      },
    ],
  },
  {
    collection: 'Home',
    description: 'Quiet, useful objects for the table and the couch.',
    products: [
      {
        title: 'Ceramic Mug',
        description: 'Hand-glazed 350 ml stoneware mug.',
        vendor: 'Shopnex',
        productType: 'Mug',
        tags: ['basics', 'bestseller'],
        images: images('ceramic-mug'),
        ...withColors(1600, ['Sand', 'Slate']),
      },
      {
        title: 'Soy Candle',
        description: 'Slow-burning soy wax candle, cedar and amber.',
        vendor: 'Shopnex',
        productType: 'Candle',
        tags: ['gift'],
        images: images('soy-candle'),
        ...simple(2000),
      },
      {
        title: 'Linen Throw Blanket',
        description: 'Stonewashed linen throw that softens with every wash.',
        vendor: 'Maison Lune',
        productType: 'Blanket',
        tags: ['winter', 'new'],
        images: images('linen-throw'),
        ...simple(7400),
      },
      {
        title: 'Glass Carafe',
        description: 'Mouth-blown 1 l carafe with a matching tumbler.',
        vendor: 'Northfield',
        productType: 'Glassware',
        images: images('glass-carafe'),
        ...simple(2800),
      },
      {
        title: 'Ceramic Planter',
        description: 'Unglazed terracotta planter with a drainage saucer.',
        vendor: 'Shopnex',
        productType: 'Planter',
        images: images('ceramic-planter'),
        ...simple(3400),
      },
    ],
  },
  {
    collection: 'Stationery',
    description: 'Tools for thinking and writing.',
    products: [
      {
        title: 'Hardcover Notebook',
        description: 'A5 notebook with 192 pages of 100 gsm dotted paper.',
        vendor: 'Shopnex',
        productType: 'Notebook',
        tags: ['basics', 'bestseller'],
        images: images('hardcover-notebook'),
        ...withColors(1400, ['Black', 'Olive', 'Rust']),
      },
      {
        title: 'Brass Pen',
        description: 'A solid brass pen that develops a patina as you use it.',
        vendor: 'Northfield',
        productType: 'Pen',
        tags: ['gift'],
        images: images('brass-pen'),
        ...simple(2600),
      },
      {
        title: 'Felt Desk Mat',
        description: 'Wool felt desk mat with a leather edge, 80 x 40 cm.',
        vendor: 'Maison Lune',
        productType: 'Desk',
        images: images('desk-mat'),
        ...simple(3600),
      },
    ],
  },
]

export async function seedDemoCatalog(shopId: string) {
  const [existing] = await db
    .select({ id: schema.products.id })
    .from(schema.products)
    .where(and(eq(schema.products.shopId, shopId), eq(schema.products.vendor, 'Maison Lune')))
    .limit(1)
  if (existing) throw new Error('The demo products already exist in this shop.')

  const collections = []
  const productIds: string[] = []
  for (const group of catalog) {
    const collection = await collectionService.create(shopId, {
      title: group.collection,
      description: group.description,
      imageUrl: group.products[0]?.images?.[0]?.url,
    })
    collections.push(collection)
    for (const input of group.products) {
      const product = await productService.create(shopId, { ...input, tags: [...(input.tags ?? []), 'demo'] })
      productIds.push(product.id)
      await collectionService.addProduct(shopId, collection.id, product.id)
    }
  }
  return { collections, productIds }
}

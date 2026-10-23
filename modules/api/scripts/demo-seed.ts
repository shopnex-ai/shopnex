// Fills an empty database with the public demo: a shop with sample products, collections, pages and menus,
// an owner (super admin) and a demo staff account that visitors sign in with.
//   pnpm demo:seed
// Refuses to run when accounts already exist; use demo:reset to start over.
//
//   DEMO_OWNER_EMAIL / DEMO_OWNER_PASSWORD   the real admin (required, keep the password private)
//   DEMO_EMAIL / DEMO_PASSWORD               the shared login shown on the demo page (defaults below)
//   APP_URL                                  public origin, saved as the shop's Storefront URL
import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { db, schema } from '@shopnex/db'
import { auth, SUPER_ADMIN_ROLE, withSignUpAllowed } from '@shopnex/auth'
import { collectionService, productService, type ProductInput } from '@shopnex/catalog'
import { menuService, pageService } from '@shopnex/content'
import { DEFAULT_SHOP_ID, addMember, ensureDefaultShop, updateShop } from '@shopnex/tenancy'

const ownerEmail = process.env.DEMO_OWNER_EMAIL?.toLowerCase()
const ownerPassword = process.env.DEMO_OWNER_PASSWORD
const demoEmail = (process.env.DEMO_EMAIL ?? 'demo@shopnex.ai').toLowerCase()
const demoPassword = process.env.DEMO_PASSWORD ?? 'shopnex-demo'

if (!ownerEmail || !ownerPassword) {
  console.error('Set DEMO_OWNER_EMAIL and DEMO_OWNER_PASSWORD (the private admin account).')
  process.exit(1)
}

const [existing] = await db.select({ id: schema.user.id }).from(schema.user).limit(1)
if (existing) {
  console.error('This database already has accounts. Run demo:reset to wipe it and seed again.')
  process.exit(1)
}

await ensureDefaultShop()
await updateShop(DEFAULT_SHOP_ID, {
  name: 'Shopnex Demo',
  currency: 'USD',
  storefrontUrl: process.env.APP_URL || null,
  seoTitle: 'Shopnex Demo Store',
  seoDescription: 'A demo store running on Shopnex, the open-source commerce platform.',
})

// The first member of a shop is its owner, later ones are staff
async function createAccount(name: string, email: string, password: string, superAdmin: boolean) {
  const { user } = await withSignUpAllowed(() => auth.api.signUpEmail({ body: { name, email, password } }))
  if (superAdmin) await db.update(schema.user).set({ role: SUPER_ADMIN_ROLE }).where(eq(schema.user.id, user.id))
  await addMember(DEFAULT_SHOP_ID, user.id)
}
await createAccount('Shop Owner', ownerEmail, ownerPassword, true)
await createAccount('Demo User', demoEmail, demoPassword, false)

const image = (seed: string) => ({ url: `https://picsum.photos/seed/${seed}/900/900`, alt: seed.replaceAll('-', ' ') })
const sizes = ['S', 'M', 'L']
const withSizes = (priceCents: number): Pick<ProductInput, 'options' | 'variants'> => ({
  options: [{ name: 'Size', values: sizes }],
  variants: sizes.map((size) => ({ options: { Size: size }, priceCents, inventoryQuantity: 25 })),
})

const catalog: { collection: string; products: ProductInput[] }[] = [
  {
    collection: 'Apparel',
    products: [
      {
        title: 'Classic Cotton Tee',
        description: 'A soft, everyday t-shirt in heavyweight cotton.',
        vendor: 'Shopnex',
        productType: 'T-shirt',
        tags: ['basics'],
        images: [image('cotton-tee')],
        ...withSizes(2400),
      },
      {
        title: 'Everyday Hoodie',
        description: 'Brushed fleece hoodie with a relaxed fit.',
        vendor: 'Shopnex',
        productType: 'Hoodie',
        tags: ['basics', 'winter'],
        images: [image('everyday-hoodie')],
        ...withSizes(5800),
      },
      {
        title: 'Linen Overshirt',
        description: 'Lightweight linen layer for warm evenings.',
        vendor: 'Shopnex',
        productType: 'Shirt',
        images: [image('linen-overshirt')],
        ...withSizes(6800),
      },
    ],
  },
  {
    collection: 'Accessories',
    products: [
      {
        title: 'Canvas Tote Bag',
        description: 'Sturdy canvas tote with an inside pocket.',
        vendor: 'Shopnex',
        productType: 'Bag',
        images: [image('canvas-tote')],
        priceCents: 1800,
      },
      {
        title: 'Wool Beanie',
        description: 'Warm ribbed beanie in merino wool.',
        vendor: 'Shopnex',
        productType: 'Hat',
        images: [image('wool-beanie')],
        priceCents: 2200,
      },
      {
        title: 'Leather Card Holder',
        description: 'Slim vegetable-tanned leather card holder.',
        vendor: 'Shopnex',
        productType: 'Wallet',
        images: [image('card-holder')],
        priceCents: 3200,
      },
    ],
  },
  {
    collection: 'Home',
    products: [
      {
        title: 'Ceramic Mug',
        description: 'Hand-glazed 350 ml stoneware mug.',
        vendor: 'Shopnex',
        productType: 'Mug',
        images: [image('ceramic-mug')],
        priceCents: 1600,
      },
      {
        title: 'Soy Candle',
        description: 'Slow-burning soy wax candle, cedar and amber.',
        vendor: 'Shopnex',
        productType: 'Candle',
        images: [image('soy-candle')],
        priceCents: 2000,
      },
    ],
  },
]

const collections = []
const productIds: string[] = []
for (const group of catalog) {
  const collection = await collectionService.create(DEFAULT_SHOP_ID, {
    title: group.collection,
    description: `${group.collection} from the Shopnex demo store.`,
    imageUrl: group.products[0]?.images?.[0]?.url,
  })
  collections.push(collection)
  for (const input of group.products) {
    const product = await productService.create(DEFAULT_SHOP_ID, input)
    productIds.push(product.id)
    await collectionService.addProduct(DEFAULT_SHOP_ID, collection.id, product.id)
  }
}

const about = await pageService.create(DEFAULT_SHOP_ID, {
  title: 'About',
  published: true,
  bodyHtml:
    "<p>This is a demo store running on <strong>Shopnex</strong>. Sign in to the admin to edit products, themes and settings.</p><p>Data resets regularly, so please don't enter real personal information.</p>",
})
const contact = await pageService.create(DEFAULT_SHOP_ID, {
  title: 'Contact',
  published: true,
  bodyHtml: '<p>Questions about Shopnex? Visit shopnex.ai.</p>',
})

await menuService.create(DEFAULT_SHOP_ID, {
  handle: 'main-menu',
  title: 'Main menu',
  items: [
    { id: randomUUID(), title: 'Home', type: 'frontpage', items: [] },
    { id: randomUUID(), title: 'Shop all', type: 'catalog', items: [] },
    ...collections.map((c) => ({
      id: randomUUID(),
      title: c.title,
      type: 'collection' as const,
      resourceId: c.id,
      items: [],
    })),
  ],
})
await menuService.create(DEFAULT_SHOP_ID, {
  handle: 'footer',
  title: 'Footer menu',
  items: [about, contact].map((p) => ({
    id: randomUUID(),
    title: p.title,
    type: 'page' as const,
    resourceId: p.id,
    items: [],
  })),
})

console.log(`Seeded ${productIds.length} products, ${collections.length} collections.`)
console.log(`Owner: ${ownerEmail} (private). Demo login: ${demoEmail} / ${demoPassword}`)
process.exit(0)

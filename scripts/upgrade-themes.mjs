// The upgrade test's check of the theme data migration (scripts/upgrade-test.sh, migration 0053): puts a saved theme in
// the format KS BootShop wrote before blocks into the previous release's database, and after the upgrade checks that the
// migration moved its content into blocks.
//
//   node scripts/upgrade-themes.mjs applies  # before the seed: exit 0 if the previous release has not run 0053 yet
//   node scripts/upgrade-themes.mjs seed     # before the upgrade
//   node scripts/upgrade-themes.mjs verify   # after it
//
// The check only means something while the release the test starts from lacks 0053. Once the latest release has it, the
// theme is converted the moment that release migrates, there is no old format left to seed, and `applies` says so (the
// script then skips seed and verify). Delete this file and its calls when 0053 is squashed away.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const NAME = 'Upgrade test: a theme saved before blocks'

const old = {
  settings: {
    color_primary: '#0a7d4f',
    show_announcement: true,
    announcement_text: 'Free shipping over $50',
    announcement_link: '/products',
  },
  pages: {
    home: {
      sections: [
        {
          id: 'hero',
          type: 'hero-carousel',
          settings: {
            height: '60vh',
            image_1: '/shopnex/assets/ks-bootshop/hero-1.jpg',
            heading_1: 'Welcome to our store',
            button_label_1: 'Shop now',
            button_link_1: '/products',
            image_2: '/shopnex/assets/ks-bootshop/hero-2.jpg',
          },
        },
        { id: 'faq', type: 'faq', settings: { question_1: 'How long is shipping?', answer_1: 'Three to five days.' } },
        { id: 'featured', type: 'featured-products', settings: { limit: 4 } },
      ],
    },
    static: { sections: [{ id: 'announcement-bar', type: 'announcement-bar', settings: { speed: 5 } }] },
  },
}

const mode = process.argv[2]
// `pg` is a dependency of @shopnex/db, not of the repo root
const require = createRequire(fileURLToPath(new URL('../modules/db/package.json', import.meta.url)))
const { Client } = require('pg')
const client = new Client({ connectionString: process.env.DATABASE_URL })
await client.connect()
try {
  if (mode === 'applies') {
    // 0053 creates this table, whatever the shop has in it
    const { rows } = await client.query(`select to_regclass('shop_themes_pre_blocks_backup') as backup`)
    process.exitCode = rows[0].backup === null ? 0 : 1
  } else if (mode === 'seed') {
    const { rows } = await client.query(`select id from shops order by created_at limit 1`)
    assert.ok(rows[0], 'the seeded shop exists')
    await client.query(
      `insert into shop_themes (shop_id, theme_id, name, role, draft, published, published_at)
       values ($1, 'ks-bootshop', $2, 'unpublished', $3::jsonb, $3::jsonb, now())`,
      [rows[0].id, NAME, JSON.stringify(old)],
    )
    console.log('Seeded a KS BootShop theme saved before blocks')
  } else if (mode === 'verify') {
    const { rows } = await client.query(`select id, draft, published from shop_themes where name = $1`, [NAME])
    assert.equal(rows.length, 1, 'the seeded theme is still there')
    for (const column of ['draft', 'published']) {
      const doc = rows[0][column]
      const [hero, faq, featured] = doc.pages.home.sections
      assert.deepEqual(hero.settings, { height: '60vh' }, `${column}: the numbered hero settings are gone`)
      assert.deepEqual(
        hero.blocks.map((b) => [b.id, b.type, b.settings.image, b.settings.heading]),
        [
          ['slide-1', 'slide', '/shopnex/assets/ks-bootshop/hero-1.jpg', 'Welcome to our store'],
          ['slide-2', 'slide', '/shopnex/assets/ks-bootshop/hero-2.jpg', undefined],
        ],
        `${column}: the slides`,
      )
      assert.deepEqual(
        faq.blocks[0].settings,
        { question: 'How long is shipping?', answer: 'Three to five days.' },
        `${column}: the FAQ`,
      )
      assert.equal(featured.blocks, undefined, `${column}: a section without numbered settings is left alone`)
      assert.deepEqual(doc.settings, { color_primary: '#0a7d4f' }, `${column}: the old announcement settings are gone`)
      const bar = doc.pages.static.sections[0]
      assert.deepEqual(bar.settings, { speed: 5 })
      assert.deepEqual(
        bar.blocks.map((b) => [b.type, b.settings]),
        [['announcement', { text: 'Free shipping over $50', link: '/products' }]],
        `${column}: the announcement`,
      )
    }
    const backup = await client.query(`select draft from shop_themes_pre_blocks_backup where id = $1`, [rows[0].id])
    assert.deepEqual(backup.rows[0]?.draft, old, 'the old document is kept in the backup table')
    console.log(
      'Upgrade moved the saved theme into blocks (draft and published), and kept a backup of the old document',
    )
  } else {
    console.error('usage: upgrade-themes.mjs seed | verify')
    process.exit(2)
  }
} finally {
  await client.end()
}

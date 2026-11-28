// 0053 moves the content saved themes keep in numbered settings (image_1, heading_1…) and in the old announcement settings
// into blocks. Runs the real migrations on an in-memory PGlite: everything up to 0052, some theme documents in the formats
// KS BootShop, Shopco, Hydrogen and Storeplate saved before blocks, then 0053 (whatever follows it is not applied).
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { cp, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { before, describe, test } from 'node:test'
import { PGlite } from '@electric-sql/pglite'
import { drizzle } from 'drizzle-orm/pglite'
import { migrate } from 'drizzle-orm/pglite/migrator'

const folder = join(import.meta.dirname, '../migrations')
const TAG = '0053_theme_documents_to_blocks'

type Doc = Record<string, unknown>
type Row = { draft: Doc; published: Doc | null }

const section = (id: string, type: string, settings: Record<string, unknown> = {}, extra: Doc = {}) => ({
  id,
  type,
  settings,
  ...extra,
})
const doc = (home: unknown[], settings: Record<string, unknown> = {}, staticSections?: unknown[]): Doc => ({
  settings,
  pages: { home: { sections: home }, ...(staticSections && { static: { sections: staticSections } }) },
})
const hash = (message: string) => createHash('md5').update(message).digest('hex').slice(0, 8)

describe('0053: saved themes get blocks from their old settings', () => {
  let client: PGlite
  const ids = new Map<string, string>()
  const inserted = new Map<string, { theme: string; draft: Doc; published: Doc | null }>()
  let xminBefore = ''

  const put = async (key: string, theme: string, draft: Doc, published: Doc | null = null) => {
    const { rows } = await client.query<{ id: string }>(
      `insert into shop_themes (shop_id, theme_id, name, draft, published) values ($1, $2, $3, $4::jsonb, $5::jsonb) returning id`,
      [`shop-${ids.size}`, theme, key, JSON.stringify(draft), published && JSON.stringify(published)],
    )
    ids.set(key, rows[0]!.id)
    inserted.set(key, { theme, draft, published })
  }
  const get = async (key: string): Promise<Row> =>
    (await client.query<Row>(`select draft, published from shop_themes where id = $1`, [ids.get(key)!])).rows[0]!
  const home = (row: Row) => (row.draft.pages as { home: { sections: Doc[] } }).home.sections
  const statics = (row: Row) => (row.draft.pages as { static?: { sections: Doc[] } }).static?.sections

  before(async () => {
    const journal = JSON.parse(await readFile(join(folder, 'meta/_journal.json'), 'utf8')) as {
      entries: { tag: string }[]
    }
    const at = journal.entries.findIndex((e) => e.tag === TAG)
    assert.notEqual(at, -1, `${TAG} is in the journal`)

    const earlier = await mkdtemp(join(tmpdir(), 'shopnex-migrations-'))
    await cp(folder, earlier, { recursive: true })
    await writeFile(
      join(earlier, 'meta/_journal.json'),
      JSON.stringify({ ...journal, entries: journal.entries.slice(0, at) }),
    )
    client = new PGlite()
    await migrate(drizzle({ client }), { migrationsFolder: earlier })
    await client.exec('SET session_replication_role = replica') // the rows need no shops

    // KS BootShop: slides with a gap and a blank position, FAQ, quotes, collections, and an announcement
    await put(
      'ks',
      'ks-bootshop',
      doc(
        [
          section('hero', 'hero-carousel', {
            height: '80vh',
            image_1: '/one.jpg',
            heading_1: 'Welcome',
            text_1: 'Hello',
            button_label_1: 'Shop',
            button_link_1: '/products',
            image_2: '',
            heading_2: '  ',
            image_3: '/three.jpg',
          }),
          section('faq', 'faq', {
            heading: 'FAQ',
            question_1: 'Returns?',
            answer_1: '30 days.',
            question_5: 'Gifts?',
            answer_5: 'Yes.',
          }),
          section('quotes', 'testimonials', { quote_1: 'Great', author_1: 'Sam', quote_3: 'Fine' }),
          section('cols', 'featured-collections', { heading: 'Shop', collection_1: 'shirts', collection_4: 'hats' }),
          section('featured', 'featured-products', { limit: 4 }),
        ],
        {
          color_primary: '#112233',
          show_announcement: true,
          announcement_text: 'Free shipping',
          announcement_link: '/sale',
        },
        [section('announcement-bar', 'announcement-bar', { speed: 5 })],
      ),
      doc([section('hero', 'hero-carousel', { image_1: '/pub.jpg' })], {}),
    )
    // Shopco: stats, collections, quotes and brand names one per line, an announcement with a link label
    await put(
      'shopco',
      'shopco',
      doc(
        [
          section('hero', 'hero', {
            heading: 'FIND CLOTHES',
            stat_1_value: '200+',
            stat_1_label: 'Brands',
            stat_3_value: '30,000+',
          }),
          section('brands', 'brands', { names: '  Versace \r\n\nZara\n   \nGucci' }),
          section('styles', 'style-grid', { heading: 'Browse', collection_2: 'casual' }),
          section('quotes', 'testimonials', { name_1: 'Sarah', quote_1: 'Lovely', name_2: 'Alex', quote_2: 'Nice' }),
        ],
        { announcement_text: 'Sign up', announcement_link_label: 'Go', announcement_link: '/signup' },
      ),
    )
    await put(
      'hydrogen',
      'hydrogen',
      doc([section('list', 'collection-list', { heading: 'Collections', collection_1: 'a', collection_6: 'f' })]),
    )
    await put(
      'storeplate',
      'storeplate',
      doc([], { announcement_text: 'Welcome back', announcement_link: '/search' }, []),
    )

    // Cases around the rules
    await put(
      'emptied',
      'ks-bootshop',
      doc([section('hero', 'hero-carousel', { image_1: '/old.jpg' }, { blocks: [] })]),
    )
    await put(
      'has-blocks',
      'ks-bootshop',
      doc([
        section(
          'hero',
          'hero-carousel',
          { image_1: '/old.jpg' },
          { blocks: [{ id: 'mine', type: 'slide', settings: {} }] },
        ),
      ]),
    )
    await put(
      'hidden',
      'ks-bootshop',
      doc([], { show_announcement: false, announcement_text: 'Hidden', announcement_link: '/x' }, [
        section('announcement-bar', 'announcement-bar'),
      ]),
    )
    await put(
      'has-message',
      'ks-bootshop',
      doc([], { announcement_text: 'Old one' }, [
        section(
          'announcement-bar',
          'announcement-bar',
          {},
          { blocks: [{ id: 'a', type: 'announcement', settings: { text: 'New one' } }] },
        ),
      ]),
    )
    await put('no-static', 'storeplate', doc([], { announcement_text: 'No bar yet' }))
    await put('blank-text', 'shopco', doc([], { announcement_text: '   ', announcement_link: '/x' }))
    // Another theme is not touched
    await put(
      'maison',
      'maison',
      doc([section('hero', 'hero-carousel', { image_1: '/keep.jpg' })], { announcement_text: 'Stay' }),
    )

    // Rows that must not stop the upgrade: shapes nothing expected, and an update that is refused
    await put(
      'poison',
      'ks-bootshop',
      doc([section('hero', 'hero-carousel', { image_1: '/p.jpg' })]),
      doc([section('hero', 'hero-carousel', { image_1: '/p2.jpg' })]),
    )
    await put(
      'null-settings',
      'ks-bootshop',
      doc([
        section('hero', 'hero-carousel', null as never),
        section('faq', 'faq', { question_1: 'Q?', answer_1: 'A.' }),
      ]),
    )
    await put('pages-array', 'ks-bootshop', { settings: { announcement_text: 'Hi' }, pages: [] })
    await put('static-string', 'ks-bootshop', {
      settings: { announcement_text: 'Hi' },
      pages: { home: { sections: [] }, static: 'oops' },
    })
    await put('sections-object', 'ks-bootshop', { settings: {}, pages: { home: { sections: { hero: 1 } } } })
    await put(
      'modern',
      'ks-bootshop',
      doc(
        [
          section(
            'hero',
            'hero-carousel',
            { height: '60vh' },
            { blocks: [{ id: 'slide-1', type: 'slide', settings: { image: '/a.jpg' } }] },
          ),
        ],
        { color_primary: '#fff' },
      ),
    )
    xminBefore = (
      await client.query<{ x: string }>(`select xmin::text as x from shop_themes where id = $1`, [ids.get('modern')!])
    ).rows[0]!.x
    await client.exec(`
      create function zz_poison() returns trigger language plpgsql as $$ begin
        if new.name = 'poison' then raise exception 'update refused'; end if; return new; end $$;
      create trigger zz_poison before update on shop_themes for each row execute function zz_poison();
      alter table shop_themes enable always trigger zz_poison;`) // always: the session runs as a replica to skip foreign keys

    const sql = await readFile(join(folder, `${TAG}.sql`), 'utf8')
    for (const statement of sql.split('--> statement-breakpoint')) await client.exec(statement)
  })

  test('KS BootShop: slides, questions, quotes and collections from the numbered settings; the gaps keep their number', async () => {
    const row = await get('ks')
    const [hero, faq, quotes, cols, featured] = home(row)
    assert.deepEqual(hero, {
      id: 'hero',
      type: 'hero-carousel',
      settings: { height: '80vh' },
      blocks: [
        {
          id: 'slide-1',
          type: 'slide',
          settings: {
            image: '/one.jpg',
            heading: 'Welcome',
            text: 'Hello',
            button_label: 'Shop',
            button_link: '/products',
          },
        },
        { id: 'slide-3', type: 'slide', settings: { image: '/three.jpg' } },
      ],
    })
    assert.deepEqual(faq, {
      id: 'faq',
      type: 'faq',
      settings: { heading: 'FAQ' },
      blocks: [
        { id: 'question-1', type: 'question', settings: { question: 'Returns?', answer: '30 days.' } },
        { id: 'question-5', type: 'question', settings: { question: 'Gifts?', answer: 'Yes.' } },
      ],
    })
    assert.deepEqual(quotes!.blocks, [
      { id: 'quote-1', type: 'quote', settings: { quote: 'Great', author: 'Sam' } },
      { id: 'quote-3', type: 'quote', settings: { quote: 'Fine' } },
    ])
    assert.deepEqual(cols!.blocks, [
      { id: 'collection-1', type: 'collection', settings: { collection: 'shirts' } },
      { id: 'collection-4', type: 'collection', settings: { collection: 'hats' } },
    ])
    assert.deepEqual(cols!.settings, { heading: 'Shop' })
    // A section that never had numbered settings is left as it is
    assert.deepEqual(featured, { id: 'featured', type: 'featured-products', settings: { limit: 4 } })
  })

  test('the published copy is converted too, and an unpublished theme stays unpublished', async () => {
    const row = await get('ks')
    const hero = (row.published!.pages as { home: { sections: { blocks: unknown[] }[] } }).home.sections[0]!
    assert.deepEqual(hero.blocks, [{ id: 'slide-1', type: 'slide', settings: { image: '/pub.jpg' } }])
    assert.equal((await get('shopco')).published, null)
  })

  test('Shopco: stats, collections, quotes, and one brand per non-blank line (trimmed)', async () => {
    const [hero, brands, styles, quotes] = home(await get('shopco'))
    assert.deepEqual(hero, {
      id: 'hero',
      type: 'hero',
      settings: { heading: 'FIND CLOTHES' },
      blocks: [
        { id: 'stat-1', type: 'stat', settings: { value: '200+', label: 'Brands' } },
        { id: 'stat-3', type: 'stat', settings: { value: '30,000+' } },
      ],
    })
    assert.deepEqual(brands, {
      id: 'brands',
      type: 'brands',
      settings: {},
      blocks: [
        { id: 'brand-1', type: 'brand', settings: { name: 'Versace' } },
        { id: 'brand-2', type: 'brand', settings: { name: 'Zara' } },
        { id: 'brand-3', type: 'brand', settings: { name: 'Gucci' } },
      ],
    })
    assert.deepEqual(styles!.blocks, [{ id: 'collection-2', type: 'collection', settings: { collection: 'casual' } }])
    assert.deepEqual(quotes!.blocks, [
      { id: 'quote-1', type: 'quote', settings: { name: 'Sarah', quote: 'Lovely' } },
      { id: 'quote-2', type: 'quote', settings: { name: 'Alex', quote: 'Nice' } },
    ])
  })

  test('Hydrogen: the collection list', async () => {
    const [list] = home(await get('hydrogen'))
    assert.deepEqual(list, {
      id: 'list',
      type: 'collection-list',
      settings: { heading: 'Collections' },
      blocks: [
        { id: 'collection-1', type: 'collection', settings: { collection: 'a' } },
        { id: 'collection-6', type: 'collection', settings: { collection: 'f' } },
      ],
    })
  })

  test('a section that has a list of blocks, even an empty one, is left as it is', async () => {
    assert.deepEqual(home(await get('emptied')), home({ draft: inserted.get('emptied')!.draft, published: null }))
    assert.deepEqual(home(await get('has-blocks')), home({ draft: inserted.get('has-blocks')!.draft, published: null }))
  })

  test('the old announcement becomes a block of the announcement bar, with its link, and the old settings are gone', async () => {
    const row = await get('ks')
    assert.deepEqual(statics(row), [
      {
        id: 'announcement-bar',
        type: 'announcement-bar',
        settings: { speed: 5 },
        blocks: [
          {
            id: `announcement-${hash('Free shipping')}`,
            type: 'announcement',
            settings: { text: 'Free shipping', link: '/sale' },
          },
        ],
      },
    ])
    assert.deepEqual(row.draft.settings, { color_primary: '#112233' })

    const shopco = await get('shopco')
    assert.deepEqual((statics(shopco) as { blocks: unknown[] }[])[0]!.blocks, [
      {
        id: `announcement-${hash('Sign up')}`,
        type: 'announcement',
        settings: { text: 'Sign up', link: '/signup', link_label: 'Go' },
      },
    ])
    assert.deepEqual(shopco.draft.settings, {})
    assert.deepEqual((statics(await get('storeplate')) as { blocks: unknown[] }[])[0]!.blocks, [
      {
        id: `announcement-${hash('Welcome back')}`,
        type: 'announcement',
        settings: { text: 'Welcome back', link: '/search' },
      },
    ])
  })

  test('the announcement bar is created when the document has none', async () => {
    assert.deepEqual(statics(await get('no-static')), [
      {
        id: 'announcement-bar',
        type: 'announcement-bar',
        settings: {},
        blocks: [{ id: `announcement-${hash('No bar yet')}`, type: 'announcement', settings: { text: 'No bar yet' } }],
      },
    ])
  })

  test('a hidden message, a blank one, or one a block already replaced adds nothing, and the old settings go', async () => {
    const hidden = await get('hidden')
    assert.deepEqual(statics(hidden), [{ id: 'announcement-bar', type: 'announcement-bar', settings: {} }])
    assert.deepEqual(hidden.draft.settings, {})
    const blank = await get('blank-text')
    assert.equal(statics(blank), undefined)
    assert.deepEqual(blank.draft.settings, {})
    const has = await get('has-message')
    assert.deepEqual((statics(has) as { blocks: unknown[] }[])[0]!.blocks, [
      { id: 'a', type: 'announcement', settings: { text: 'New one' } },
    ])
    assert.deepEqual(has.draft.settings, {})
  })

  test('a theme the migration does not cover is not touched', async () => {
    const maison = await get('maison')
    assert.deepEqual(maison.draft, inserted.get('maison')!.draft)
  })

  test('running the conversions again changes nothing', async () => {
    const row = await get('ks')
    const { rows } = await client.query<{ again: Doc }>(
      `select shopnex_theme_announcement_to_block(
                shopnex_theme_blocks_from_settings($1::jsonb, 'hero-carousel', 'slide', '{"image":"image_{n}"}'::jsonb, 3),
                'announcement_text', 'announcement_link', null, 'show_announcement') as again`,
      [JSON.stringify(row.draft)],
    )
    assert.deepEqual(rows[0]!.again, row.draft)
  })

  test('a row that cannot be converted is left as it was, the rest are converted, and why is recorded', async () => {
    const poison = await get('poison')
    assert.deepEqual(poison.draft, inserted.get('poison')!.draft)
    assert.deepEqual(poison.published, inserted.get('poison')!.published)
    const errors = await client.query<{ id: string; error: string }>(
      `select id, error from shop_themes_pre_blocks_backup where error is not null`,
    )
    assert.deepEqual(errors.rows, [{ id: ids.get('poison')!, error: 'update refused' }])
    // The others of the same theme were converted
    assert.equal((home(await get('ks'))[0] as { blocks?: unknown[] }).blocks?.length, 2)
  })

  test('documents of an unexpected shape are left alone and do not stop the upgrade', async () => {
    for (const key of ['pages-array', 'static-string', 'sections-object'])
      assert.deepEqual((await get(key)).draft, inserted.get(key)!.draft, key)
    // A section whose settings is null is skipped; another section of the same document is still converted
    const [hero, faq] = home(await get('null-settings'))
    assert.deepEqual(hero, { id: 'hero', type: 'hero-carousel', settings: null })
    assert.deepEqual(faq, {
      id: 'faq',
      type: 'faq',
      settings: {},
      blocks: [{ id: 'question-1', type: 'question', settings: { question: 'Q?', answer: 'A.' } }],
    })
  })

  test('a row with nothing to convert is not written', async () => {
    const x = (
      await client.query<{ x: string }>(`select xmin::text as x from shop_themes where id = $1`, [ids.get('modern')!])
    ).rows[0]!.x
    assert.equal(x, xminBefore)
    assert.deepEqual((await get('modern')).draft, inserted.get('modern')!.draft)
  })

  test('the old documents are kept in a backup table, for the themes that were changed only, and updated_at is as it was', async () => {
    const { rows } = await client.query<{ theme_id: string }>(
      `select theme_id from shop_themes_pre_blocks_backup order by theme_id, id`,
    )
    const themes = new Set(rows.map((r) => r.theme_id))
    assert.deepEqual([...themes].sort(), ['hydrogen', 'ks-bootshop', 'shopco', 'storeplate'])
    const ks = (
      await client.query<{ draft: Doc }>(`select draft from shop_themes_pre_blocks_backup where id = $1`, [
        ids.get('ks')!,
      ])
    ).rows[0]!
    assert.deepEqual(ks.draft, inserted.get('ks')!.draft)
    const touched = await client.query<{ n: number }>(
      `select count(*)::int n from shop_themes where updated_at > created_at`,
    )
    assert.equal(touched.rows[0]!.n, 0)
  })
})

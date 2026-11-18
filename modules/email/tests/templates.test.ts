// Settings → Notifications: the Liquid of each email, edited, reverted, previewed with the shop's latest order and sent as a test,
// the list of recent emails, and the sign-in code email. Plus the Liquid engine's rules (no files, no scripts, HTML escaped).
import assert from 'node:assert/strict'
import { after, before, beforeEach, describe, test } from 'node:test'
import * as fx from './fixtures'
import { emailDeliveries, emailTemplates } from '../src/email.schema'

const { db, eq, SHOP, received } = fx
const { notificationService, sendLoginCode, checkLiquid, EmailError } = await import('../src')
const { render } = await import('../src/liquid')
const { DEFAULTS } = await import('../src/defaults')
const { NOTIFICATIONS } = await import('../src/email.schema')

const refused = (code: string) => (e: unknown) => e instanceof EmailError && e.code === code

before(async () => {
  await fx.prepareDatabase()
  await fx.startSmtp()
})
beforeEach(async () => {
  await fx.cleanup()
  fx.resetSmtp()
})
after(async () => {
  await fx.cleanup()
  await fx.stopSmtp()
})

describe('the list', () => {
  test('every notification, in order, each on and not customized until the shop changes it', async () => {
    const list = await notificationService.list(SHOP)
    assert.deepEqual(
      list.map((n) => n.notification),
      [
        'order_confirmation',
        'shipping_confirmation',
        'order_cancelled',
        'staff_order',
        'login_code',
        'abandoned_cart',
        'layout',
      ],
    )
    assert.deepEqual(new Set(list.map((n) => n.notification)), new Set(NOTIFICATIONS))
    for (const n of list) assert.equal(n.customized, false, n.notification)
    assert.deepEqual(
      list.map((n) => [n.notification, n.audience]).filter(([, a]) => a !== 'customer'),
      [
        ['staff_order', 'staff'],
        ['layout', 'layout'],
      ],
    )
    assert.equal(list.find((n) => n.notification === 'order_confirmation')?.enabled, true)
  })

  test('the abandoned cart email is off until its own switch is turned on; the others follow their template row', async () => {
    assert.equal(
      (await notificationService.list(SHOP)).find((n) => n.notification === 'abandoned_cart')?.enabled,
      false,
    )
    await notificationService.update(SHOP, 'order_cancelled', { enabled: false })
    await notificationService.update(SHOP, 'abandoned_cart', { enabled: true })
    const list = await notificationService.list(SHOP)
    assert.deepEqual(
      [
        list.find((n) => n.notification === 'abandoned_cart')?.enabled,
        list.find((n) => n.notification === 'order_cancelled')?.enabled,
      ],
      [true, false],
    )
  })
})

describe('reading and editing one', () => {
  test('without edits it is the built-in subject and body, with the defaults alongside', async () => {
    const n = await notificationService.get(SHOP, 'order_confirmation')
    assert.deepEqual(
      [n.subject, n.body, n.customized, n.enabled],
      [DEFAULTS.order_confirmation.subject, DEFAULTS.order_confirmation.body, false, true],
    )
    assert.deepEqual(n.defaults, DEFAULTS.order_confirmation)
  })

  test('an edit is saved for the shop only, and is customized', async () => {
    await fx.otherShop()
    const saved = await notificationService.update(SHOP, 'shipping_confirmation', {
      subject: 'On its way, {{ order.name }}',
    })
    assert.deepEqual(
      [saved.subject, saved.body, saved.customized],
      ['On its way, {{ order.name }}', DEFAULTS.shipping_confirmation.body, true],
    )
    assert.equal(
      (await notificationService.get(fx.OTHER_SHOP, 'shipping_confirmation')).subject,
      DEFAULTS.shipping_confirmation.subject,
    )
  })

  test('text equal to the default is stored as "default" (null), so later changes to the defaults apply', async () => {
    await notificationService.update(SHOP, 'order_confirmation', { subject: 'Custom' })
    await notificationService.update(SHOP, 'order_confirmation', { subject: DEFAULTS.order_confirmation.subject })
    const [row] = await db.select().from(emailTemplates).where(eq(emailTemplates.shopId, SHOP))
    assert.deepEqual([row?.subject, row?.body], [null, null])
    assert.equal((await notificationService.get(SHOP, 'order_confirmation')).customized, false)
  })

  test('Liquid with a syntax error is INVALID_TEMPLATE, naming the part and, for the body, the line; nothing is saved', async () => {
    await assert.rejects(
      notificationService.update(SHOP, 'order_confirmation', { subject: '{{ order.name ' }),
      (e: unknown) => {
        assert.ok(e instanceof EmailError)
        assert.equal(e.code, 'INVALID_TEMPLATE')
        assert.match(e.message, /^Subject: /)
        return true
      },
    )
    await assert.rejects(
      notificationService.update(SHOP, 'order_confirmation', { body: '<p>ok</p>\n<p>{% if %}</p>' }),
      (e: unknown) => e instanceof EmailError && /^Body \(line 2\): /.test(e.message),
    )
    assert.equal((await db.select().from(emailTemplates)).length, 0)
  })

  test('turning one off is its own switch: it stays customized or not, and the layout cannot be turned off', async () => {
    const off = await notificationService.update(SHOP, 'shipping_confirmation', { enabled: false })
    assert.deepEqual([off.enabled, off.customized], [false, false])
    const layout = await notificationService.update(SHOP, 'layout', { enabled: false })
    assert.equal(layout.enabled, true)
  })

  test('revert goes back to the built-in text and leaves the switch alone', async () => {
    await notificationService.update(SHOP, 'order_cancelled', { subject: 'Nope', body: '<p>Nope</p>', enabled: false })
    const back = await notificationService.revert(SHOP, 'order_cancelled')
    assert.deepEqual(
      [back.subject, back.body, back.customized, back.enabled],
      [DEFAULTS.order_cancelled.subject, DEFAULTS.order_cancelled.body, false, false],
    )
  })
})

describe('the preview', () => {
  test('with no order yet it shows a made-up one and says so', async () => {
    const p = await notificationService.preview(SHOP, 'order_confirmation', DEFAULTS.order_confirmation)
    assert.equal(p.sample, true)
    assert.match(p.subject, /#1001/)
    assert.match(p.html, /Classic T-shirt/)
    assert.equal(p.problem, null)
  })

  test('with an order it shows the latest one', async () => {
    await fx.order({ email: 'older@example.test', createdAt: new Date(Date.now() - 86_400_000) })
    const latest = await fx.order({ email: 'latest@example.test' })
    const p = await notificationService.preview(SHOP, 'order_confirmation', {
      subject: 'Hi {{ order.email }}',
      body: '<p>{{ order.name }}</p>',
    })
    assert.equal(p.sample, false)
    assert.equal(p.subject, 'Hi latest@example.test')
    assert.match(p.html, new RegExp(`#${String(latest.orderNumber)}`))
  })

  test('unsaved Liquid is rendered as given; a problem comes back, not thrown', async () => {
    const p = await notificationService.preview(SHOP, 'order_confirmation', {
      subject: 'S',
      body: '<p>{{ order.name | nope }}</p>',
    })
    assert.ok(p.problem)
    assert.match(p.problem.message, /nope/)
  })

  test('the layout previews around the order confirmation, and the abandoned cart email with the order’s products', async () => {
    const layout = await notificationService.preview(SHOP, 'layout', {
      subject: '',
      body: '<main>{{ content_for_layout }}</main>',
    })
    assert.match(layout.html, /^<main>[\s\S]*<\/main>$/)
    const cart = await notificationService.preview(SHOP, 'abandoned_cart', {
      subject: 'Left behind',
      body: '{% for l in checkout.line_items %}[{{ l.title }}]{% endfor %} {{ unsubscribe_url }}',
    })
    assert.match(cart.html, /\[Classic T-shirt\]\[Canvas tote bag\]/)
    assert.match(cart.html, /\/unsubscribe\/preview/)
  })
})

describe('the test send', () => {
  test('goes to the person asking, through the shop’s email, with [Test] in the subject', async () => {
    await fx.turnOn()
    const result = await notificationService.sendTest(
      SHOP,
      'order_confirmation',
      DEFAULTS.order_confirmation,
      'staff@example.test',
    )
    assert.deepEqual(result, { to: 'staff@example.test' })
    assert.equal(received.length, 1)
    assert.match(received[0]!.subject, /^\[Test\] /)
    assert.deepEqual(received[0]?.to, ['staff@example.test'])
  })

  test('refuses Liquid with a problem, and says when email is off', async () => {
    await fx.turnOn()
    await assert.rejects(
      notificationService.sendTest(
        SHOP,
        'order_confirmation',
        { subject: 'S', body: '{{ x | nope }}' },
        'staff@example.test',
      ),
      refused('INVALID_TEMPLATE'),
    )
    await fx.cleanup()
    await assert.rejects(
      notificationService.sendTest(SHOP, 'order_confirmation', DEFAULTS.order_confirmation, 'staff@example.test'),
      refused('EMAIL_OFF'),
    )
    assert.equal(received.length, 0)
  })
})

describe('recent emails', () => {
  test('newest first, only this shop’s, without the HTML, and no more than the limit', async () => {
    await fx.otherShop()
    const o = await fx.order()
    for (const [i, to] of ['a', 'b', 'c'].entries()) {
      await db.insert(emailDeliveries).values({
        shopId: SHOP,
        notification: 'order_confirmation',
        orderId: o.id,
        to: `${to}@example.test`,
        subject: to,
        html: '<p>secret body</p>',
        createdAt: new Date(Date.now() - (3 - i) * 1000),
      })
    }
    await db
      .insert(emailDeliveries)
      .values({ shopId: fx.OTHER_SHOP, notification: 'layout', to: 'x@example.test', subject: 'x', html: '' })
    const recent = await notificationService.deliveries(SHOP)
    assert.deepEqual(
      recent.map((d) => d.subject),
      ['c', 'b', 'a'],
    )
    assert.equal(JSON.stringify(recent).includes('secret body'), false)
    assert.equal((await notificationService.deliveries(SHOP, 2)).length, 2)
  })
})

describe('the sign-in code email', () => {
  test('is sent right away to the customer, with the code and how long it works', async () => {
    await fx.turnOn()
    await sendLoginCode(SHOP, 'customer@example.test', '123456')
    assert.equal(received.length, 1)
    assert.deepEqual(received[0]?.to, ['customer@example.test'])
    assert.match(received[0]!.raw, /123456/)
    assert.match(received[0]!.raw, /10 minutes/)
    assert.equal(
      (await db.select().from(emailDeliveries)).length,
      0,
      'not queued: nobody should see the code in the outbox',
    )
  })

  test('EMAIL_OFF when the shop does not send email, or turned sign-in off by disabling the template', async () => {
    await assert.rejects(sendLoginCode(SHOP, 'c@example.test', '123456'), refused('EMAIL_OFF'))
    await fx.turnOn()
    await notificationService.update(SHOP, 'login_code', { enabled: false })
    await assert.rejects(sendLoginCode(SHOP, 'c@example.test', '123456'), refused('EMAIL_OFF'))
    assert.equal(received.length, 0)
  })

  test('an unknown shop is EMAIL_FAILED', async () => {
    await assert.rejects(sendLoginCode('no-such-shop', 'c@example.test', '123456'), refused('EMAIL_FAILED'))
  })
})

describe('the Liquid engine', () => {
  test('checkLiquid says null for a template that parses and the problem, with its line, for one that does not', () => {
    assert.equal(checkLiquid('<p>{{ order.name }}</p>'), null)
    const problem = checkLiquid('line one\n{% if %}')
    assert.equal(problem?.line, 2)
    assert.ok(problem?.message)
  })

  test('HTML output is escaped, `raw` opts out, subjects are plain text', async () => {
    const scope = { v: '<b>&"\'</b>' }
    assert.deepEqual(await render('{{ v }}', scope), { ok: true, output: '&lt;b&gt;&amp;&#34;&#39;&lt;/b&gt;' })
    assert.deepEqual(await render('{{ v | raw }}', scope), { ok: true, output: '<b>&"\'</b>' })
    assert.deepEqual(await render('{{ v }}', scope, { html: false }), { ok: true, output: '<b>&"\'</b>' })
  })

  test('nothing reads the disk, an unknown filter is an error, and a loop that would never end is stopped (by the memory or the time limit)', async () => {
    const include = await render('{% render "secret" %}', {})
    assert.equal(include.ok, false)
    const filter = await render('{{ x | nope }}', { x: 1 })
    assert.equal(filter.ok, false)
    const loop = await render('{% for i in (1..100000) %}{% for j in (1..100000) %}x{% endfor %}{% endfor %}', {})
    assert.equal(loop.ok, false)
  })

  test('money is in the order’s currency from minor units, pluralize and newline_to_br work', async () => {
    assert.deepEqual(await render('{{ p | money }}', { p: 2550, order: { currency: 'USD' } }), {
      ok: true,
      output: '$25.50',
    })
    assert.deepEqual(await render("{{ n | pluralize: 'item', 'items' }}", { n: 1 }), { ok: true, output: 'item' })
    assert.deepEqual(await render("{{ n | pluralize: 'item', 'items' }}", { n: 3 }), { ok: true, output: 'items' })
    assert.deepEqual(await render('{{ t | newline_to_br }}', { t: 'a\nb<' }), { ok: true, output: 'a<br>b&lt;' })
    assert.deepEqual(await render('{{ p | money }}', { p: '' }), { ok: true, output: '' })
  })
})

// The MCP server end to end, the way AI clients really run it: a separate process started from the config snippet
// in the README, speaking JSON-RPC over stdio, against the running app and its database.
//
// Claude Desktop, Cursor, Cline and Windsurf all do the same thing: spawn `command args` with `env` from a JSON
// config, write newline-delimited JSON-RPC to its stdin, read its stdout. They fail on a polluted stdout, a missing
// handshake version, a wrong working directory or a schema the model API rejects. Those are what is checked here.
// (The apps' own windows can't be driven from a test; `MCP_E2E_CLAUDE=1` also runs the real Claude Code client.)
import assert from 'node:assert/strict'
import { type ChildProcess, execFile, spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { after, before, describe, test } from 'node:test'
import { promisify } from 'node:util'
import { eq, inArray, like } from 'drizzle-orm'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { db, schema } from '@shopnex/db'
import { APP_URL, Fixtures, SHOP, call, closeDb, ok, requireApp } from '../lib'

const exec = promisify(execFile)
const fx = new Fixtures()
const run = Date.now().toString(36)
const REPO = resolve(import.meta.dirname, '../..')
const TITLE = `E2E MCP ${run}`

// ---- the documented config, as a client would read it ----

type McpEntry = { command: string; args: string[]; env: Record<string, string> }

/** The first JSON block of the README: what a user is told to paste into their client */
function documentedConfig(): McpEntry {
  const readme = readFileSync(join(REPO, 'packages/mcp/README.md'), 'utf8')
  const block = /```json\n([\s\S]*?)```/.exec(readme)?.[1]
  assert.ok(block, 'packages/mcp/README.md has no JSON config block')
  const entry = (JSON.parse(block) as { mcpServers: { shopnex: McpEntry } }).mcpServers.shopnex
  assert.ok(entry?.command && entry.args, 'the README config has no shopnex server')
  return entry
}

/** What the user fills in: their paths, URL and token */
function launch(token: string, extraEnv: Record<string, string> = {}) {
  const entry = documentedConfig()
  return {
    command: entry.command,
    args: entry.args.map((a) => a.replace('/path/to/shopnex', REPO)),
    // Desktop apps start servers with a small environment, not the developer's shell
    env: {
      PATH: process.env.PATH ?? '',
      HOME: process.env.HOME ?? '',
      ...entry.env,
      SHOPNEX_URL: APP_URL,
      SHOPNEX_TOKEN: token,
      // The documented snippet is read-only; tests that write opt out (and say so) by leaving it off
      SHOPNEX_READ_ONLY: '',
      ...extraEnv,
    },
  }
}

// ---- a bare-bones client: newline-delimited JSON-RPC, nothing smart ----

class RawClient {
  private buffer = ''
  private pending = new Map<number, (message: any) => void>()
  readonly stdoutLines: string[] = []
  stderr = ''
  private id = 0
  readonly exited: Promise<number | null>

  constructor(private child: ChildProcess) {
    child.stdout!.on('data', (chunk: Buffer) => {
      this.buffer += chunk.toString()
      let nl: number
      while ((nl = this.buffer.indexOf('\n')) >= 0) {
        const line = this.buffer.slice(0, nl)
        this.buffer = this.buffer.slice(nl + 1)
        if (!line.trim()) continue
        this.stdoutLines.push(line)
        try {
          const message = JSON.parse(line)
          this.pending.get(message.id)?.(message)
        } catch {
          // recorded in stdoutLines; the test that cares checks every line parses
        }
      }
    })
    child.stderr!.on('data', (chunk: Buffer) => (this.stderr += chunk.toString()))
    this.exited = new Promise((done) => child.on('exit', (code) => done(code)))
  }

  request(method: string, params: unknown = {}, timeoutMs = 60_000) {
    const id = ++this.id
    const reply = new Promise<any>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`no answer to ${method} (stderr: ${this.stderr.slice(-400)})`)),
        timeoutMs,
      )
      this.pending.set(id, (message) => {
        clearTimeout(timer)
        resolve(message)
      })
    })
    this.child.stdin!.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n')
    return reply
  }

  notify(method: string, params: unknown = {}) {
    this.child.stdin!.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n')
  }

  async initialize(protocolVersion: string) {
    const reply = await this.request('initialize', {
      protocolVersion,
      capabilities: {},
      clientInfo: { name: 'raw-test-client', version: '0' },
    })
    this.notify('notifications/initialized')
    return reply
  }

  close() {
    this.child.stdin!.end()
    setTimeout(() => this.child.kill(), 3000).unref()
    return this.exited
  }
}

function start(token: string, cwd: string, extraEnv: Record<string, string> = {}) {
  const { command, args, env } = launch(token, extraEnv)
  return new RawClient(spawn(command, args, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] }))
}

// ---- setup ----

const productIds: string[] = []
let adminHeaders: Record<string, string>
let writeToken: string
let readToken: string
let elsewhere: string // a working directory that is not the repo, as desktop apps use

const WRITE = ['write_products', 'write_orders', 'write_discounts', 'write_customers'] as const
const READ = ['read_products', 'read_orders', 'read_discounts', 'read_customers'] as const

/** An MCP client the SDK way (what most hosts embed), speaking to the documented command */
async function sdkClient(token: string, extraEnv: Record<string, string> = {}) {
  const { command, args, env } = launch(token, extraEnv)
  const client = new Client({ name: 'sdk-test-client', version: '0' })
  await client.connect(new StdioClientTransport({ command, args, env, cwd: elsewhere, stderr: 'pipe' }))
  const tool = async (name: string, input: Record<string, unknown> = {}) => {
    const res = await client.callTool({ name, arguments: input })
    const text = (res.content as { text: string }[])[0]!.text
    return { isError: Boolean(res.isError), text, data: res.isError ? null : JSON.parse(text) }
  }
  return { client, tool }
}

before(async () => {
  await requireApp()
  await fx.init()
  elsewhere = mkdtempSync(join(tmpdir(), 'mcp-e2e-'))
  writeToken = (await fx.mintToken([...WRITE])).token
  readToken = (await fx.mintToken([...READ])).token
  adminHeaders = await fx.token(['write_products', 'write_orders'])
})

after(async () => {
  await fx.cleanup()
  const mine = await db
    .select({ id: schema.products.id })
    .from(schema.products)
    .where(like(schema.products.title, `${TITLE}%`))
  const ids = [...productIds, ...mine.map((p) => p.id)]
  if (ids.length) await db.delete(schema.products).where(inArray(schema.products.id, ids))
  rmSync(elsewhere, { recursive: true, force: true })
  await closeDb()
})

describe('starting like a desktop app does', () => {
  test('the config in the README is read-only unless the user changes it', () => {
    assert.equal(documentedConfig().env.SHOPNEX_READ_ONLY, '1')
  })

  for (const version of ['2024-11-05', '2025-03-26', '2025-06-18']) {
    test(`the README config handshakes at protocol ${version}, from another directory, with a small environment`, async () => {
      const server = start(writeToken, elsewhere)
      try {
        const reply = await server.initialize(version)
        assert.ok(reply.result, JSON.stringify(reply))
        assert.ok(reply.result.protocolVersion, 'the server must answer with a protocol version')
        assert.equal(reply.result.serverInfo.name, 'shopnex')
        assert.ok(reply.result.capabilities.tools, 'tools capability')

        const list = await server.request('tools/list')
        assert.equal(list.result.tools.length, 20)

        // stdout is the protocol: any other output breaks every client
        for (const line of server.stdoutLines) {
          const message = JSON.parse(line)
          assert.equal(message.jsonrpc, '2.0', `not JSON-RPC on stdout: ${line.slice(0, 120)}`)
        }
        assert.match(server.stderr, /connected to/)
      } finally {
        await server.close()
      }
    })
  }

  test('ends when the client closes stdin', async () => {
    const server = start(writeToken, elsewhere)
    await server.initialize('2025-06-18')
    assert.equal(await server.close(), 0)
  })

  test('without a URL or token it says what is missing on stderr and keeps stdout clean', async () => {
    const { command, args } = launch('')
    const child = spawn(command, args, {
      cwd: elsewhere,
      env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '' },
    })
    let out = ''
    let err = ''
    child.stdout.on('data', (c) => (out += c))
    child.stderr.on('data', (c) => (err += c))
    const code = await new Promise((done) => child.on('exit', done))
    assert.notEqual(code, 0)
    assert.equal(out, '')
    assert.match(err, /SHOPNEX_URL/)
  })
})

describe('what a model is handed', () => {
  test('every tool has a valid schema and the read-only flag really drops the writes', async () => {
    const full = await sdkClient(writeToken)
    const readOnly = await sdkClient(writeToken, { SHOPNEX_READ_ONLY: '1' })
    try {
      const all = (await full.client.listTools()).tools
      const safe = (await readOnly.client.listTools()).tools
      assert.equal(all.length, 20)
      assert.ok(safe.length > 0 && safe.length < all.length)
      for (const t of all) {
        assert.equal(t.inputSchema.type, 'object', t.name)
        assert.ok(t.description && t.description.length > 30, t.name)
        JSON.stringify(t.inputSchema) // must serialize: a client sends this to the model API as is
      }
      for (const t of safe)
        assert.equal(t.annotations?.readOnlyHint, true, `${t.name} is a write tool in read-only mode`)
      // Even a client that ignores the list can't call what isn't there
      assert.equal(
        (await readOnly.tool('cancel_order', { id: crypto.randomUUID(), reason: 'other', restock: false })).isError,
        true,
      )
    } finally {
      await Promise.all([full.client.close(), readOnly.client.close()])
    }
  })
})

describe('against the real shop', () => {
  test('reads: shop, sales summary, products, orders', async () => {
    const s = await sdkClient(writeToken)
    try {
      assert.equal((await s.tool('get_shop')).data.id, SHOP)
      const summary = (await s.tool('sales_summary', { days: 30 })).data
      assert.ok(summary.current && summary.previous && summary.attention)
      const products = (await s.tool('list_products', { limit: 3 })).data
      assert.ok(products.total >= 1 && products.items.length <= 3)
      assert.ok(typeof products.items[0].title === 'string')
      const orders = (await s.tool('list_orders', { limit: 2 })).data
      assert.ok('total' in orders && 'nextOffset' in orders)
    } finally {
      await s.client.close()
    }
  })

  test('a drafted product is a draft, stays hidden, and goes live only after confirm', async () => {
    const s = await sdkClient(writeToken)
    try {
      const created = (await s.tool('create_product_draft', { title: TITLE, price: 12.5, tags: ['e2e-mcp'] })).data
      productIds.push(created.id)
      assert.equal(created.status, 'draft')
      assert.deepEqual(created.priceCents, { min: 1250, max: 1250 })

      const status = async () => {
        const [row] = await db
          .select({ status: schema.products.status })
          .from(schema.products)
          .where(eq(schema.products.id, created.id))
        return row!.status
      }
      assert.equal(await status(), 'draft')

      const found = (await s.tool('list_products', { search: TITLE })).data
      assert.deepEqual(
        found.items.map((p: { id: string }) => p.id),
        [created.id],
      )

      // The first call only says what would happen
      const dry = (await s.tool('publish_product', { id: created.id })).data
      assert.equal(dry.done, false)
      assert.match(dry.message, /confirm: true/)
      assert.equal(await status(), 'draft')

      assert.equal((await s.tool('publish_product', { id: created.id, confirm: true })).data.done, true)
      assert.equal(await status(), 'active')
      assert.equal((await s.tool('archive_product', { id: created.id, confirm: true })).data.done, true)
      assert.equal(await status(), 'archived')
    } finally {
      await s.client.close()
    }
  })

  test('a discount is created inactive and only turns on after confirm', async () => {
    const s = await sdkClient(writeToken)
    const code = `E2EMCP${run}`.toUpperCase()
    try {
      const created = (await s.tool('create_discount_draft', { code, type: 'percentage', value: 15 })).data
      fx.discount(created.id)
      assert.equal(created.active, false)
      const active = async () =>
        (
          await db
            .select({ a: schema.discounts.active })
            .from(schema.discounts)
            .where(eq(schema.discounts.id, created.id))
        )[0]!.a

      assert.equal((await s.tool('activate_discount', { id: created.id })).data.done, false)
      assert.equal(await active(), false)
      await s.tool('activate_discount', { id: created.id, active: true, confirm: true })
      assert.equal(await active(), true)
    } finally {
      await s.client.close()
    }
  })

  test('cancelling an order previews first, then cancels and puts the stock back', async () => {
    // An order for a tracked variant, placed through the storefront like a customer would
    const product = ok(
      await call(
        'POST',
        '/admin/products',
        { title: `${TITLE} stock`, variants: [{ priceCents: 1000, inventoryQuantity: 5 }] },
        adminHeaders,
      ),
    )
    productIds.push(product.id)
    const variantId = product.variants[0].id as string
    const shippingRate = await fx.shippingRate(0)
    const cart = await fx.cart([{ merchandiseId: variantId, quantity: 2 }])
    const placed = await fx.complete(cart.id, { countryCode: 'US' }, shippingRate.id)
    assert.equal(placed.status, 200, JSON.stringify(placed.body))
    const orderId = placed.body.orderId as string
    fx.order(orderId)

    const stock = async () =>
      (
        await db
          .select({ n: schema.productVariants.inventoryQuantity })
          .from(schema.productVariants)
          .where(eq(schema.productVariants.id, variantId))
      )[0]!.n
    const cancelledAt = async () =>
      (await db.select({ c: schema.orders.cancelledAt }).from(schema.orders).where(eq(schema.orders.id, orderId)))[0]!.c
    assert.equal(await stock(), 3)

    const s = await sdkClient(writeToken)
    try {
      const dry = (await s.tool('cancel_order', { id: orderId, reason: 'customer', restock: true })).data
      assert.equal(dry.done, false)
      assert.equal(await cancelledAt(), null)
      assert.equal(await stock(), 3)

      assert.equal(
        (await s.tool('cancel_order', { id: orderId, reason: 'customer', restock: true, confirm: true })).data.done,
        true,
      )
      assert.notEqual(await cancelledAt(), null)
      assert.equal(await stock(), 5)

      // Again: said so, nothing happens twice
      assert.match(
        (await s.tool('cancel_order', { id: orderId, reason: 'customer', restock: true, confirm: true })).data.message,
        /already cancelled/,
      )
      assert.equal(await stock(), 5)
    } finally {
      await s.client.close()
    }
  })

  test('a token without write scopes cannot change anything, and the model is told which scope', async () => {
    const s = await sdkClient(readToken)
    try {
      assert.ok((await s.tool('list_products', { limit: 1 })).data.total >= 1)
      const refused = await s.tool('create_product_draft', { title: `${TITLE} nope`, price: 1 })
      assert.equal(refused.isError, true)
      assert.match(refused.text, /write_products/)
      const [row] = await db
        .select({ id: schema.products.id })
        .from(schema.products)
        .where(eq(schema.products.title, `${TITLE} nope`))
      assert.equal(row, undefined)
    } finally {
      await s.client.close()
    }
  })

  test('a revoked or wrong token says so instead of failing silently', async () => {
    const s = await sdkClient('sk_not-a-real-token')
    try {
      const r = await s.tool('get_shop')
      assert.equal(r.isError, true)
      assert.match(r.text, /token was rejected/)
    } finally {
      await s.client.close()
    }
  })
})

// A real MCP client with a real model: Claude Code. Costs a little, so it is opt-in:
//   MCP_E2E_CLAUDE=1 pnpm e2e
describe('Claude Code as the client', { skip: process.env.MCP_E2E_CLAUDE !== '1' }, () => {
  test('finds a product through the shopnex server', async () => {
    const title = `${TITLE} claude`
    ok(await call('POST', '/admin/products', { title, variants: [{ priceCents: 1999 }] }, adminHeaders))

    const dir = mkdtempSync(join(tmpdir(), 'mcp-claude-'))
    try {
      const config = join(dir, 'mcp.json')
      writeFileSync(config, JSON.stringify({ mcpServers: { shopnex: launch((await fx.mintToken([...READ])).token) } }))
      const { stdout } = await exec(
        'claude',
        [
          '-p',
          `Use the shopnex list_products tool to search for "${title}" and answer with the product's price in cents, nothing else.`,
          '--mcp-config',
          config,
          '--strict-mcp-config',
          '--allowedTools',
          'mcp__shopnex__list_products',
          '--output-format',
          'json',
          '--max-turns',
          '4',
        ],
        { cwd: dir, timeout: 180_000 },
      )
      const result = JSON.parse(stdout) as { result: string; is_error?: boolean }
      assert.ok(!result.is_error, stdout.slice(0, 400))
      assert.match(result.result, /1999|19\.99/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

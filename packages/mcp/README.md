# @shopnex/mcp

An [MCP](https://modelcontextprotocol.io) server for ShopNex: ask Claude, Cursor, Cline, Windsurf or n8n about your
store and have them draft changes for you. It talks to your instance's Admin API with an API token, so it can never do
more than that token's scopes allow.

## Set up

1. In the admin: **Settings → API tokens → Create**. Give it the scopes you want to hand over:
   - read-only: `read_products`, `read_orders`, `read_customers`, `read_discounts`
   - to let it make changes: the matching `write_*` scopes
2. Add the server to your client. For Claude Desktop (`claude_desktop_config.json`) or Cursor (`.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "shopnex": {
      "command": "npx",
      "args": ["-y", "tsx", "/path/to/shopnex/packages/mcp/src/bin.ts"],
      "env": {
        "SHOPNEX_URL": "https://shop.example.com",
        "SHOPNEX_TOKEN": "sk_…",
        "SHOPNEX_READ_ONLY": "1"
      }
    }
  }
}
```

`SHOPNEX_READ_ONLY=1` removes every tool that changes something, whatever the token allows. Use one entry per shop (a
token belongs to one shop).

## What it does

Twenty hand-picked tools, not one per endpoint. Answers are summaries (a page, the total, and `nextOffset` to continue).

| Read                                                                                                                                                         | Change (drafts)                                                                     | Goes live: needs `confirm: true`                                                                              |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `get_shop`, `sales_summary`, `list_products`, `get_product`, `low_stock`, `list_orders`, `get_order`, `list_customers`, `list_discounts`, `list_collections` | `create_product_draft`, `update_product`, `update_variant`, `create_discount_draft` | `publish_product`, `archive_product`, `activate_discount`, `mark_order_paid`, `fulfill_order`, `cancel_order` |

- New products and discount codes start as **drafts**: customers can't see or use them until published or activated.
- Tools that go live, ship, cancel or refund only describe what they would do until called again with `confirm: true`.
  The server tells the model to show you that description first.
- Prices you type are in the shop currency (`19.99`); amounts the tools return as `…Cents` are the smallest unit.

## Limits

- `update_product` and `update_variant` change a live product at once; there is no draft of an edit yet.
- Creates are not idempotent: if a call times out, check before repeating it.
- `low_stock` scans up to 1000 products and says whether it saw them all.

## Develop

```sh
pnpm --filter @shopnex/mcp test        # in-memory client ↔ server against a fake API
pnpm --filter @shopnex/mcp typecheck
SHOPNEX_URL=http://localhost:3000 SHOPNEX_TOKEN=sk_… pnpm --filter @shopnex/mcp start   # stdio
```

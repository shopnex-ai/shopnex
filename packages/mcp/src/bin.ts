#!/usr/bin/env -S npx tsx
// shopnex-mcp: stdio MCP server. SHOPNEX_URL and SHOPNEX_TOKEN are required; SHOPNEX_READ_ONLY=1 drops write tools.
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { createClient } from './client'
import { createServer } from './server'

const { SHOPNEX_URL: url, SHOPNEX_TOKEN: token, SHOPNEX_READ_ONLY } = process.env
if (!url || !token) {
  // stdout is the protocol: diagnostics go to stderr
  console.error(
    'shopnex-mcp needs SHOPNEX_URL (e.g. https://shop.example.com) and SHOPNEX_TOKEN (Settings → API tokens).',
  )
  process.exit(1)
}

const readOnly = ['1', 'true', 'yes'].includes((SHOPNEX_READ_ONLY ?? '').toLowerCase())
await createServer(createClient({ url, token }), { readOnly }).connect(new StdioServerTransport())
console.error(`shopnex-mcp connected to ${url}${readOnly ? ' (read-only)' : ''}`)

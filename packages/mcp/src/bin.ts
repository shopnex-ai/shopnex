// shopnex-mcp: stdio MCP server. SHOPNEX_URL and SHOPNEX_TOKEN are required; SHOPNEX_READ_ONLY=1 drops write tools.
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import pkg from '../package.json' with { type: 'json' }
import { createClient } from './client'
import { createServer } from './server'

const USAGE = `shopnex-mcp ${pkg.version}: an MCP server for a ShopNex store (talks to your MCP client over stdio)

Environment:
  SHOPNEX_URL         your store, e.g. https://shop.example.com or http://localhost:3000
  SHOPNEX_TOKEN       Admin API token (sk_…), from Settings → API tokens
  SHOPNEX_READ_ONLY   1: offer no tool that changes anything

Add it to a client, e.g.: claude mcp add shopnex -e SHOPNEX_URL=… -e SHOPNEX_TOKEN=… -- npx -y @shopnex/mcp`

const flag = process.argv[2]
if (flag === '--version' || flag === '-v') {
  console.log(pkg.version)
  process.exit(0)
}
if (flag === '--help' || flag === '-h') {
  console.log(USAGE)
  process.exit(0)
}

const { SHOPNEX_URL: url, SHOPNEX_TOKEN: token, SHOPNEX_READ_ONLY } = process.env
if (!url || !token) {
  // stdout is the protocol: diagnostics go to stderr
  console.error(
    'shopnex-mcp needs SHOPNEX_URL (e.g. https://shop.example.com) and SHOPNEX_TOKEN (Settings → API tokens).',
  )
  console.error('Run shopnex-mcp --help for details.')
  process.exit(1)
}

const readOnly = ['1', 'true', 'yes'].includes((SHOPNEX_READ_ONLY ?? '').toLowerCase())
await createServer(createClient({ url, token }), { readOnly, version: pkg.version }).connect(new StdioServerTransport())
console.error(`shopnex-mcp ${pkg.version} connected to ${url}${readOnly ? ' (read-only)' : ''}`)

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { ApiError, type ShopnexClient } from './client'
import { TOOLS, type Tool } from './tools'

export type ServerOptions = {
  /** Leave out every tool that changes something */
  readOnly?: boolean
  version?: string
}

/** Tools offered for these options */
export const toolsFor = ({ readOnly }: ServerOptions = {}): Tool[] => TOOLS.filter((t) => !(readOnly && t.write))

const text = (value: unknown) => ({ type: 'text' as const, text: JSON.stringify(value) })

function failure(error: unknown) {
  // Expected API refusals (bad id, missing scope) are for the model to read and react to; anything else too, briefly
  const message = error instanceof ApiError ? error.message : error instanceof Error ? error.message : String(error)
  return { isError: true as const, content: [{ type: 'text' as const, text: message }] }
}

export function createServer(client: ShopnexClient, options: ServerOptions = {}) {
  const server = new McpServer(
    { name: 'shopnex', version: options.version ?? '0.1.0' },
    {
      instructions:
        'Tools for running a ShopNex store. Amounts ending in "Cents" are in the smallest currency unit; inputs named ' +
        '"price" are in the shop currency. New products and discounts start as drafts. Anything that goes live, ' +
        'ships, cancels or refunds needs `confirm: true`: first call it without, tell the user what would happen, ' +
        'and only confirm after they say yes.',
    },
  )
  for (const t of toolsFor(options)) {
    server.registerTool(
      t.name,
      {
        title: t.title,
        description: t.description,
        inputSchema: t.input,
        annotations: {
          readOnlyHint: !t.write,
          destructiveHint: Boolean(t.gated),
          idempotentHint: !t.write,
          openWorldHint: false,
        },
      },
      async (args: Record<string, unknown>) => {
        try {
          const parsed = z.object(t.input).parse(args)
          return { content: [text(await t.run(parsed, client))] }
        } catch (error) {
          return failure(error)
        }
      },
    )
  }
  return server
}

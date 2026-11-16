import { useQueryClient } from '@tanstack/react-query'
import { ImportDialog, createEach } from '@/components/admin/import-dialog'
import { parseCsv } from '@/lib/csv'
import { client, orpc } from '@/lib/orpc'

type RedirectRecord = { fromPath: string; toPath: string }

// Shopify exports "Redirect from" and "Redirect to"; ShopNex's own names also work
const columns = [
  ['Redirect from', 'Redirect to'],
  ['fromPath', 'toPath'],
] as const

function parseRedirects(text: string): RedirectRecord[] {
  const rows = parseCsv(text, 'redirect')
  const headers = Object.keys(rows[0] ?? {})
  const pair = columns.find(([from, to]) => headers.includes(from) && headers.includes(to))
  if (!pair) {
    throw new Error('This doesn’t look like a redirects CSV. It needs the columns “Redirect from” and “Redirect to”.')
  }
  const seen = new Set<string>()
  return rows.flatMap((row, index) => {
    const fromPath = row[pair[0]] ?? ''
    const toPath = row[pair[1]] ?? ''
    if (!fromPath && !toPath) return []
    if (!fromPath.startsWith('/') || !toPath) {
      throw new Error(`Row ${index + 2}: the old URL must start with / and the new URL can’t be empty.`)
    }
    if (seen.has(fromPath)) throw new Error(`Row ${index + 2}: ${fromPath} appears twice in this file.`)
    seen.add(fromPath)
    return [{ fromPath, toPath }]
  })
}

export function ImportRedirectsDialog() {
  const queryClient = useQueryClient()
  return (
    <ImportDialog<RedirectRecord>
      title="Import redirects"
      description="Upload a redirects CSV, for example from Shopify. Old URLs that already redirect are skipped, not changed."
      noun="redirects"
      hint="One row per redirect, with the columns “Redirect from” and “Redirect to”."
      parse={parseRedirects}
      previewHeaders={['Old URL', 'New URL']}
      previewRow={(r) => [r.fromPath, r.toPath]}
      run={(redirects, onProgress) =>
        createEach(
          redirects,
          (r) => r.fromPath,
          (r) => client.admin.redirects.create(r),
          onProgress,
        )
      }
      onFinished={() => queryClient.invalidateQueries({ queryKey: orpc.admin.redirects.key() })}
    />
  )
}

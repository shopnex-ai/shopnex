const BOM = String.fromCharCode(0xfeff)

export type CsvRow = Record<string, string>

function cell(value: unknown) {
  const text = value == null ? '' : String(value)
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

export function csvTable(headers: string[], records: unknown[][]) {
  return [headers, ...records].map((record) => record.map(cell).join(',')).join('\r\n')
}

export function downloadCsv(csv: string, filename: string) {
  const url = URL.createObjectURL(new Blob([BOM, csv], { type: 'text/csv;charset=utf-8' }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `${filename}-${new Date().toISOString().slice(0, 10)}.csv`
  anchor.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** Parses CSV text into rows keyed by header; handles quotes, embedded newlines, BOMs and `;` or tab delimiters. */
export function parseCsv(text: string, noun = 'data'): CsvRow[] {
  const source = text.startsWith(BOM) ? text.slice(1) : text
  const firstLine = source.split(/\r?\n/, 1)[0] ?? ''
  const delimiter = [',', ';', '\t'].reduce((best, candidate) =>
    firstLine.split(candidate).length > firstLine.split(best).length ? candidate : best, ',')
  const rows: string[][] = []
  let row: string[] = [], field = '', quoted = false
  for (let i = 0; i < source.length; i++) {
    const ch = source[i]!
    if (quoted) {
      if (ch === '"' && source[i + 1] === '"') { field += '"'; i++ }
      else if (ch === '"') quoted = false
      else field += ch
    } else if (ch === '"') quoted = true
    else if (ch === delimiter) { row.push(field); field = '' }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && source[i + 1] === '\n') i++
      row.push(field); field = ''
      if (row.some((value) => value.trim())) rows.push(row)
      row = []
    } else field += ch
  }
  row.push(field)
  if (row.some((value) => value.trim())) rows.push(row)
  if (rows.length < 2) throw new Error(`This CSV has no ${noun} rows.`)
  const headers = rows[0]!.map((header) => header.trim())
  return rows.slice(1).map((values) => Object.fromEntries(headers.map((header, i) => [header, values[i]?.trim() ?? ''])))
}

/** Fails with a readable message when the CSV is missing columns the importer needs. */
export function requireColumns(rows: CsvRow[], columns: string[], format: string) {
  const headers = Object.keys(rows[0] ?? {})
  const missing = columns.filter((column) => !headers.includes(column))
  if (missing.length) throw new Error(`This doesn't look like a ${format} CSV. Missing column${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}.`)
}

/** Runs `task` over `items` with limited concurrency, reporting progress. Order of results matches `items`. */
export async function mapPool<T, R>(items: T[], size: number, task: (item: T, index: number) => Promise<R>, onProgress?: (done: number) => void) {
  const results = new Array<R>(items.length)
  let next = 0, done = 0
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
    while (next < items.length) {
      const index = next++
      results[index] = await task(items[index]!, index)
      onProgress?.(++done)
    }
  }))
  return results
}

/** Collects every page of a limit/offset list endpoint. */
export async function fetchAll<T>(fetchPage: (page: { limit: number; offset: number }) => Promise<{ items: T[] }>) {
  const all: T[] = []
  for (let offset = 0; ; offset += 100) {
    const { items } = await fetchPage({ limit: 100, offset })
    all.push(...items)
    if (items.length < 100) return all
  }
}

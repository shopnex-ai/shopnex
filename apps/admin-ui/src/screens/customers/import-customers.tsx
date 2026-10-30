import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { FormatSelect, ImportDialog, platformOptions, createEach } from '@/components/admin/import-dialog'
import { parseCsv } from '@/lib/csv'
import { client, orpc } from '@/lib/orpc'

type ImportedCustomer = { email: string; name: string | null; phone: string | null }

type Source = 'shopify' | 'woocommerce' | 'magento'
const sources = platformOptions<Source>(['shopify', 'woocommerce', 'magento'], 'Customers CSV')

// Column names each platform's customer export uses (first match wins)
const columns: Record<Source, { email: string[]; name: string[]; first: string[]; last: string[]; phone: string[] }> = {
  shopify: {
    email: ['Email'],
    name: ['Name'],
    first: ['First Name'],
    last: ['Last Name'],
    phone: ['Phone', 'Default Address Phone'],
  },
  woocommerce: {
    email: ['user_email', 'billing_email', 'Email', 'email'],
    name: ['Name'],
    first: ['first_name', 'billing_first_name', 'First Name'],
    last: ['last_name', 'billing_last_name', 'Last Name'],
    phone: ['billing_phone', 'Phone'],
  },
  magento: {
    email: ['email'],
    name: [],
    first: ['firstname'],
    last: ['lastname'],
    phone: ['billing_telephone', 'telephone', 'phone'],
  },
}

function parseCustomers(text: string, source: Source): ImportedCustomer[] {
  const rows = parseCsv(text, 'customer')
  const map = columns[source]
  const pick = (row: Record<string, string>, names: string[]) => names.map((name) => row[name]).find(Boolean) ?? ''
  if (!map.email.some((name) => name in rows[0]!)) {
    throw new Error(
      `This doesn't look like a ${sources.find((option) => option.value === source)!.label} customers CSV. Expected an ${map.email[0]} column.`,
    )
  }
  const seen = new Set<string>()
  const customers: ImportedCustomer[] = []
  rows.forEach((row, index) => {
    const email = pick(row, map.email).toLowerCase()
    if (!email) return
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      throw new Error(`Row ${index + 2}: “${email}” is not a valid email address.`)
    if (seen.has(email)) return
    seen.add(email)
    customers.push({
      email,
      name: pick(row, map.name) || [pick(row, map.first), pick(row, map.last)].filter(Boolean).join(' ') || null,
      phone: pick(row, map.phone) || null,
    })
  })
  if (!customers.length) throw new Error('No customers with an email address were found.')
  return customers
}

export function ImportCustomersDialog() {
  const queryClient = useQueryClient()
  const [source, setSource] = useState<Source>('shopify')

  return (
    <ImportDialog<ImportedCustomer>
      title="Import customers"
      description="Upload a customers CSV from another platform. Customers whose email already exists are skipped, not changed."
      noun="customers"
      hint="Needs an email column; name and phone are optional."
      resetKey={source}
      options={<FormatSelect label="Import from" value={source} options={sources} onChange={setSource} />}
      parse={(text) => parseCustomers(text, source)}
      previewHeaders={['Email', 'Name', 'Phone']}
      previewRow={(customer) => [customer.email, customer.name ?? '—', customer.phone ?? '—']}
      run={(customers, onProgress) =>
        createEach(
          customers,
          (c) => c.email,
          (c) => client.admin.customers.create(c),
          onProgress,
          4,
        )
      }
      onFinished={() => queryClient.invalidateQueries({ queryKey: orpc.admin.customers.key() })}
    />
  )
}

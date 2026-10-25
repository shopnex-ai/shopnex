import { useState } from 'react'
import { ExportDialog, FormatSelect, platformOptions } from '@/components/admin/import-dialog'
import { csvTable, fetchAll } from '@/lib/csv'
import { client } from '@/lib/orpc'

type Source = 'shopify' | 'woocommerce' | 'magento'
type Customer = Awaited<ReturnType<typeof client.admin.customers.list>>['items'][number]
const formats = platformOptions<Source>(['shopify', 'woocommerce', 'magento'], 'Customers CSV')

const split = (name: string | null) => {
  const [first = '', ...rest] = (name ?? '').trim().split(/\s+/)
  return [first, rest.join(' ')]
}

const exporters: Record<Source, (customers: Customer[]) => string> = {
  shopify: (customers) => csvTable(['First Name', 'Last Name', 'Email', 'Phone'],
    customers.map((c) => [...split(c.name), c.email, c.phone])),
  woocommerce: (customers) => csvTable(['user_email', 'first_name', 'last_name', 'billing_email', 'billing_phone'],
    customers.map((c) => [c.email, ...split(c.name), c.email, c.phone])),
  magento: (customers) => csvTable(['email', '_website', '_store', 'firstname', 'lastname', 'group_id', 'created_at', 'billing_telephone'],
    customers.map((c) => [c.email, 'base', 'admin', ...split(c.name), 1, new Date(c.createdAt).toISOString().slice(0, 19).replace('T', ' '), c.phone])),
}

export function ExportCustomersDialog() {
  const [source, setSource] = useState<Source>('shopify')

  async function build() {
    const customers = await fetchAll((page) => client.admin.customers.list(page))
    return { csv: exporters[source](customers), count: customers.length }
  }

  return <ExportDialog title="Export customers" noun="customers" filename={`shopnex-customers-${source}`} build={build}
    description="Download your customers as a CSV formatted for another commerce platform.">
    <FormatSelect label="Export format" value={source} options={formats} onChange={setSource} />
  </ExportDialog>
}

import type { MailingAddress } from '@shopnex/api/schemas'
import { countryName } from '@/lib/countries'

// Postal block, one line per part (format is the same for every country for now)
export function AddressLines({ address }: { address: MailingAddress }) {
  const lines = [
    [address.firstName, address.lastName].filter(Boolean).join(' '),
    address.company,
    address.address1,
    address.address2,
    [address.zip, address.city].filter(Boolean).join(' '),
    address.province,
    countryName(address.countryCode),
    address.phone,
  ].filter(Boolean)
  return (
    <address className="text-sm not-italic leading-relaxed">
      {lines.map((line, i) => (
        <div key={i}>{line}</div>
      ))}
    </address>
  )
}

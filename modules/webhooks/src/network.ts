// Outbound requests to addresses a merchant typed in (webhook endpoints, storage buckets): in multi-tenant
// mode they must not reach the platform's own network.
import { lookup } from 'node:dns/promises'
import { BlockList, isIP } from 'node:net'

const privateRanges = new BlockList()
for (const [net, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16], // includes cloud metadata (169.254.169.254)
  ['172.16.0.0', 12],
  ['192.168.0.0', 16],
] as const) {
  privateRanges.addSubnet(net, prefix, 'ipv4')
}
for (const [net, prefix] of [
  ['::', 128],
  ['::1', 128],
  ['fc00::', 7],
  ['fe80::', 10],
] as const) {
  privateRanges.addSubnet(net, prefix, 'ipv6')
}

function isPrivateAddress(address: string) {
  const mapped = address.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i)?.[1]
  if (mapped) return privateRanges.check(mapped, 'ipv4')
  return privateRanges.check(address, isIP(address) === 6 ? 'ipv6' : 'ipv4')
}

// Best effort: fetch resolves the host again, so DNS rebinding can still slip through
export async function assertPublicHost(url: URL) {
  const host = url.hostname.replace(/^\[|\]$/g, '')
  const addresses = isIP(host) ? [{ address: host }] : await lookup(host, { all: true })
  if (addresses.some((a) => isPrivateAddress(a.address))) {
    throw new Error(`${host} resolves to a private network address`)
  }
}

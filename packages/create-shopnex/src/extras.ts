import { UsageError } from './errors'

/** An optional app create-shopnex can start next to the shop (--with <name>): its own server, in the bundle's apps/ folder */
export type Extra = {
  name: string
  label: string
  /** The folder in the bundle's apps/ and in the shop folder's apps/ (where it keeps its data) */
  dir: string
  port: number
  /** The variable that holds the app's public address, for the app and for the admin (which registers it when it is set) */
  urlEnv: string
  /** The variable that holds the app's private key, next to its address: the app's identity */
  keyEnv: string
}

export const extras: Extra[] = [
  { name: 'stripe', label: 'Stripe', dir: 'stripe', port: 4600, urlEnv: 'STRIPE_APP_URL', keyEnv: 'STRIPE_APP_KEY' },
  {
    name: 'cj',
    label: 'CJ Dropshipping',
    dir: 'cj-dropshipping',
    port: 4700,
    urlEnv: 'CJ_DROPSHIPPING_APP_URL',
    keyEnv: 'CJ_DROPSHIPPING_APP_KEY',
  },
  { name: 'shippo', label: 'Shippo', dir: 'shippo', port: 4900, urlEnv: 'SHIPPO_APP_URL', keyEnv: 'SHIPPO_APP_KEY' },
]

/** --with stripe,cj (and --with stripe --with cj) → the apps, once each; unknown names are usage errors */
export function pickExtras(values: string[] | undefined, list: Extra[] = extras): Extra[] {
  const names = (values ?? []).flatMap((value) => value.split(',')).map((name) => name.trim().toLowerCase())
  const picked: Extra[] = []
  for (const name of names.filter(Boolean)) {
    const found = list.find((extra) => extra.name === name)
    if (!found)
      throw new UsageError(`Unknown app "${name}" for --with. Available: ${list.map((e) => e.name).join(', ')}.`)
    if (!picked.includes(found)) picked.push(found)
  }
  return picked
}

// Shared by the import-store scripts: a polite fetch (identified, slowed down) and a guard so they only write to a scratch database.
export const UA = 'ShopNexImportProbe/0.1 (reads the public catalog of a store its owner pasted)'

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** One request at a time, with a pause before it: stores rate-limit (HTTP 429) quickly */
export async function getText(url: string, accept = '*/*') {
  await sleep(300)
  const res = await fetch(url, { headers: { 'user-agent': UA, accept }, signal: AbortSignal.timeout(20_000) })
  if (!res.ok) throw new Error(`${url}: ${res.status}`)
  return res.text()
}

export async function getJson(url: string) {
  return JSON.parse(await getText(url, 'application/json')) as any
}

/** These scripts add products and a theme to the default shop: refuse any database that is not named like a scratch one */
export function assertScratchDb() {
  if (!/\/shopnex_(main|scratch)[\w-]*(\?|$)/.test(process.env.DATABASE_URL ?? '')) {
    throw new Error('Refusing to run: DATABASE_URL must point to a scratch database (shopnex_main or shopnex_scratch*)')
  }
}

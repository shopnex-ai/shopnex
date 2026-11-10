import * as p from '@clack/prompts'
import { planFromBundle, type Plan } from './plan'
import { UsageError } from './errors'
import type { Extra } from './extras'

export type PlanInput = {
  root: string
  /** The shop's folder: optional apps keep their data in <shopDir>/apps/<name> */
  shopDir: string
  /** Optional apps to start next to the shop (--with) */
  extras: Extra[]
  /** DATABASE_URL */
  databaseUrl: string
  port: number
  storefrontPort: number
  /** SHOPNEX_SECRET */
  secret: string
  /** The other settings of the shop's .env, passed to the admin */
  env: Record<string, string>
}

/** One thing create-shopnex can start. Add an entry to `apps` to make it pickable (--app <name>, or the picker) */
export type AppDef = {
  name: string
  label: string
  hint: string
  plan: (input: PlanInput) => Plan
}

export const apps: AppDef[] = [
  {
    name: 'shop',
    label: 'Shop',
    hint: 'the admin with the API and checkout, and the storefront',
    plan: planFromBundle,
  },
]

/**
 * Which app to start. --app wins. With one app registered (today) nothing is asked: zero questions. Once there are
 * several, a terminal gets a picker and anything else (a pipe, CI) gets the first one.
 */
export async function pickApp(
  name: string | undefined,
  { interactive, list = apps }: { interactive: boolean; list?: AppDef[] },
): Promise<AppDef> {
  if (name !== undefined) {
    const found = list.find((app) => app.name === name)
    if (!found) throw new UsageError(`Unknown app "${name}". Available: ${list.map((app) => app.name).join(', ')}.`)
    return found
  }
  const [first] = list
  if (!first) throw new UsageError('No apps are registered.')
  if (list.length === 1 || !interactive) return first

  const answer = await p.select({
    message: 'What do you want to start?',
    options: list.map((app) => ({ value: app.name, label: app.label, hint: app.hint })),
  })
  if (p.isCancel(answer)) {
    p.cancel('Nothing was started.')
    process.exit(0)
  }
  return list.find((app) => app.name === answer) ?? first
}

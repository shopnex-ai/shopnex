// Settings → Email: how a shop sends email. Off by default (messages are only logged), or any SMTP server:
// Resend, Postmark, SendGrid, Mailgun, SES, Brevo, Gmail… all offer SMTP, so one transport covers them and
// presets only prefill the form. Saving checks the server accepts the login first.
import { eq } from 'drizzle-orm'
import nodemailer from 'nodemailer'
import { db, schema } from '@shopnex/db'
import type { EmailSettings, SmtpConfig } from '@shopnex/db/schema'
import { decryptSecret, encryptSecret } from '@shopnex/db/secrets'
import { isMultiTenant } from '@shopnex/tenancy'
import { assertPublicHost } from '@shopnex/webhooks/network'
import { EmailError } from './errors'

/** Omit password to keep the one already saved */
export type SmtpInput = SmtpConfig & { password?: string }

export type EmailMessage = { to: string; subject: string; text?: string; html?: string; replyTo?: string }

async function settingsRow(shopId: string) {
  const [row] = await db.select().from(schema.emailSettings).where(eq(schema.emailSettings.shopId, shopId))
  return row ?? null
}

// Never returns the password, only whether one is saved
export async function getSettings(shopId: string) {
  const row = await settingsRow(shopId)
  return {
    provider: row?.active ? ('smtp' as const) : ('off' as const),
    smtp: row ? { ...row.config, hasPassword: row.password !== null } : null,
  }
}

async function passwordFor(shopId: string, input: SmtpInput) {
  if (!input.username) return null
  if (input.password) return input.password
  const row = await settingsRow(shopId)
  if (!row?.password) throw new EmailError('PASSWORD_REQUIRED', 'Enter the password')
  return decryptSecret(row.password)
}

const configOf = ({ password: _, ...config }: SmtpInput): SmtpConfig => config

// A login is never sent unencrypted: port 465 is TLS from the start, other ports must upgrade with STARTTLS
async function transportFor(config: SmtpConfig, password: string | null) {
  // Best effort, like webhooks: the transport resolves the host again
  if (isMultiTenant) await assertPublicHost(new URL(`smtp://${config.host}`))
  return nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.port === 465,
    requireTLS: config.port !== 465 && Boolean(config.username),
    auth: config.username ? { user: config.username, pass: password ?? '' } : undefined,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  })
}

const fromOf = (config: SmtpConfig) =>
  config.fromName ? { name: config.fromName, address: config.fromEmail } : config.fromEmail

export type TestStep = { step: 'connect' | 'send'; ok: boolean; error?: string }

const message = (error: unknown) => (error instanceof Error ? error.message : String(error))

// Logs in to the server, then sends a test message to `to` (the staff member running the test)
export async function test(shopId: string, input: SmtpInput, to: string) {
  const config = configOf(input)
  const steps: TestStep[] = []
  const run = async (step: TestStep['step'], fn: () => Promise<unknown>) => {
    try {
      await fn()
      steps.push({ step, ok: true })
      return true
    } catch (error) {
      steps.push({ step, ok: false, error: message(error) })
      return false
    }
  }

  const transport = await transportFor(config, await passwordFor(shopId, input))
  if (await run('connect', () => transport.verify())) {
    await run('send', () =>
      transport.sendMail({
        from: fromOf(config),
        to,
        subject: 'Test email from your shop',
        text: `Your email settings work: this message was sent through ${config.host} from ${config.fromEmail}.`,
      }),
    )
  }
  transport.close()
  return { ok: steps.every((s) => s.ok), steps }
}

// Email goes through this server from now on. The login is checked first, so a broken setup never saves.
export async function useSmtp(shopId: string, input: SmtpInput) {
  const config = configOf(input)
  const password = await passwordFor(shopId, input)
  const transport = await transportFor(config, password)
  try {
    await transport.verify()
  } catch (error) {
    throw new EmailError('EMAIL_FAILED', `Could not log in to ${config.host}: ${message(error)}`)
  } finally {
    transport.close()
  }

  const values = { config, password: password === null ? null : encryptSecret(password), active: true }
  await db
    .insert(schema.emailSettings)
    .values({ shopId, ...values })
    .onConflictDoUpdate({ target: schema.emailSettings.shopId, set: { ...values, updatedAt: new Date() } })
  return getSettings(shopId)
}

// Stops sending; the setup stays for switching back on
export async function turnOff(shopId: string) {
  await db
    .update(schema.emailSettings)
    .set({ active: false, updatedAt: new Date() })
    .where(eq(schema.emailSettings.shopId, shopId))
  return getSettings(shopId)
}

const activeRow = async (shopId: string): Promise<EmailSettings | null> => {
  const row = await settingsRow(shopId)
  return row?.active ? row : null
}

/** Sends from the shop's address. With email off it's only logged, and `sent` is false. */
export async function send(shopId: string, email: EmailMessage) {
  const row = await activeRow(shopId)
  if (!row) {
    console.info(`[email] off for shop ${shopId}, not sent: "${email.subject}" to ${email.to}`)
    return { sent: false }
  }
  const transport = await transportFor(row.config, row.password === null ? null : decryptSecret(row.password))
  try {
    await transport.sendMail({ from: fromOf(row.config), ...email })
  } catch (error) {
    throw new EmailError('EMAIL_FAILED', `Could not send "${email.subject}": ${message(error)}`)
  } finally {
    transport.close()
  }
  return { sent: true }
}
